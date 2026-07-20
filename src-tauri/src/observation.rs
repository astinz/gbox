use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

use anyhow::Result;
use serde_json::json;
use tauri::{AppHandle, Emitter};
use tokio::{sync::Notify, time::Duration};

use crate::{
    codex::CodexSupervisor,
    domain::Observation,
    store::{EnqueuedObservation, ObservationWork, Store},
};

pub struct ObservationService {
    app: AppHandle,
    store: Arc<Store>,
    codex: Arc<CodexSupervisor>,
    wake: Notify,
    healthy: AtomicBool,
    retry_delay: Duration,
}

impl ObservationService {
    pub fn new(app: AppHandle, store: Arc<Store>, codex: Arc<CodexSupervisor>) -> Arc<Self> {
        Arc::new(Self {
            app,
            store,
            codex,
            wake: Notify::new(),
            healthy: AtomicBool::new(false),
            retry_delay: Duration::from_secs(30),
        })
    }

    pub fn start(self: &Arc<Self>) -> Result<()> {
        self.store.recover_observations()?;
        self.healthy.store(true, Ordering::Relaxed);
        let service = self.clone();
        tauri::async_runtime::spawn(async move {
            service.run().await;
        });
        self.wake.notify_one();
        Ok(())
    }

    pub fn enqueue(
        &self,
        session_id: &str,
        turn_id: Option<&str>,
        cwd: Option<&str>,
        source: &str,
        message: &str,
    ) -> Result<EnqueuedObservation> {
        let enqueued = self
            .store
            .enqueue_observation(session_id, turn_id, cwd, source, message)?;
        if enqueued.inserted {
            let _ = self
                .app
                .emit("gbox://observation-queued", &enqueued.observation);
            self.wake.notify_one();
        }
        Ok(enqueued)
    }

    pub fn retry(&self, observation_id: &str) -> Result<Observation> {
        let observation = self.store.retry_observation(observation_id)?;
        let _ = self.app.emit("gbox://observation-queued", &observation);
        self.wake.notify_one();
        Ok(observation)
    }

    pub fn healthy(&self) -> bool {
        self.healthy.load(Ordering::Relaxed)
    }

    async fn run(self: Arc<Self>) {
        loop {
            match self.store.claim_next_observation() {
                Ok(Some(work)) => self.process(work).await,
                Ok(None) => self.wake.notified().await,
                Err(error) => {
                    self.healthy.store(false, Ordering::Relaxed);
                    let _ = self.app.emit(
                        "gbox://observation-failed",
                        json!({"error": error.to_string()}),
                    );
                    tokio::time::sleep(Duration::from_secs(1)).await;
                    self.healthy.store(true, Ordering::Relaxed);
                }
            }
        }
    }

    async fn process(&self, work: ObservationWork) {
        let observation = work.observation;
        let terminal_attempt = observation.attempts >= 2;
        let result = self
            .codex
            .ingest_observation_text(
                &observation.session_id,
                observation.turn_id.as_deref(),
                &work.message_body,
            )
            .await;
        match result {
            Ok(claims) => match self.store.complete_observation(&observation.id, &claims) {
                Ok(completed) => {
                    let _ = self.app.emit("gbox://observation-completed", completed);
                }
                Err(error) => self.fail(&observation.id, &error.to_string()),
            },
            Err(error) if !terminal_attempt => {
                if self
                    .store
                    .defer_observation(&observation.id, &error.to_string())
                    .is_ok()
                {
                    tokio::time::sleep(self.retry_delay).await;
                } else {
                    self.fail(&observation.id, &error.to_string());
                }
            }
            Err(error) => self.fail(&observation.id, &error.to_string()),
        }
    }

    fn fail(&self, observation_id: &str, failure: &str) {
        let payload = self
            .store
            .fail_observation(observation_id, failure)
            .map(|observation| serde_json::to_value(observation).unwrap_or_default())
            .unwrap_or_else(|error| {
                json!({
                    "observationId": observation_id,
                    "error": error.to_string(),
                })
            });
        let _ = self.app.emit("gbox://observation-failed", payload);
    }
}
