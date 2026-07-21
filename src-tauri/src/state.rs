use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

use anyhow::Result;

use crate::{
    codex::CodexSupervisor,
    domain::{DashboardSnapshot, SystemStatus},
    gate::ActionGate,
    observation::ObservationService,
    store::Store,
};

pub struct ApplicationState {
    pub store: Arc<Store>,
    pub codex: Arc<CodexSupervisor>,
    pub gate: Arc<ActionGate>,
    pub observations: Arc<ObservationService>,
    replay_mode: AtomicBool,
    global_observation: AtomicBool,
    notifications_available: AtomicBool,
    launch_at_login: AtomicBool,
    notch_enabled: AtomicBool,
}

impl ApplicationState {
    pub fn new(
        store: Arc<Store>,
        codex: Arc<CodexSupervisor>,
        gate: Arc<ActionGate>,
        observations: Arc<ObservationService>,
        launch_at_login: bool,
    ) -> Arc<Self> {
        let global_observation = store
            .get_setting("global_observation")
            .ok()
            .flatten()
            .is_some_and(|value| value == "true");
        let notch_enabled = store
            .get_setting("notch_enabled")
            .ok()
            .flatten()
            .map_or(cfg!(target_os = "macos"), |value| value == "true");
        Arc::new(Self {
            store,
            codex,
            gate,
            observations,
            replay_mode: AtomicBool::new(false),
            global_observation: AtomicBool::new(global_observation),
            notifications_available: AtomicBool::new(false),
            launch_at_login: AtomicBool::new(launch_at_login),
            notch_enabled: AtomicBool::new(notch_enabled),
        })
    }

    pub fn status(&self) -> SystemStatus {
        let mut status = self.codex.status();
        status.global_observation = self.global_observation.load(Ordering::Relaxed);
        status.observation_worker_healthy = self.observations.healthy();
        status.observation_queue_depth = self.store.observation_queue_depth().unwrap_or(0);
        status.notifications_available = self.notifications_available.load(Ordering::Relaxed);
        status.launch_at_login = self.launch_at_login.load(Ordering::Relaxed);
        status.notch_available = cfg!(target_os = "macos");
        status.notch_enabled = self.notch_enabled.load(Ordering::Relaxed);
        status.replay_mode = self.replay_mode.load(Ordering::Relaxed);
        status.receipt_chain_valid = self.store.verify_receipt_chain().unwrap_or(false);
        status
    }

    pub fn snapshot(&self) -> Result<DashboardSnapshot> {
        Ok(DashboardSnapshot {
            status: self.status(),
            claims: self.store.list_claims()?,
            evidence: self.store.list_evidence()?,
            actions: self.store.list_actions()?,
            decisions: self.store.list_decisions()?,
            receipts: self.store.list_receipts()?,
            events: self.store.list_events()?,
            evidence_settings: self.codex.evidence_settings(),
            evidence_sources: self.codex.evidence_sources(),
            verification_failures: self.store.list_verification_failures()?,
            recent_observations: self.store.list_recent_observations()?,
            observation_queue_depth: self.store.observation_queue_depth()?,
        })
    }

    pub fn set_global_observation(&self, enabled: bool) -> Result<SystemStatus> {
        self.global_observation.store(enabled, Ordering::Relaxed);
        self.store
            .set_setting("global_observation", if enabled { "true" } else { "false" })?;
        Ok(self.status())
    }

    pub fn global_observation(&self) -> bool {
        self.global_observation.load(Ordering::Relaxed)
    }

    pub fn set_notifications_available(&self, available: bool) -> SystemStatus {
        self.notifications_available
            .store(available, Ordering::Relaxed);
        self.status()
    }

    pub fn set_launch_at_login(&self, enabled: bool) -> Result<SystemStatus> {
        self.launch_at_login.store(enabled, Ordering::Relaxed);
        self.store
            .set_setting("launch_at_login_configured", "true")?;
        Ok(self.status())
    }

    pub fn launch_at_login_configured(&self) -> bool {
        self.store
            .get_setting("launch_at_login_configured")
            .ok()
            .flatten()
            .is_some_and(|value| value == "true")
    }

    pub fn set_notch_enabled(&self, enabled: bool) -> Result<SystemStatus> {
        self.notch_enabled.store(enabled, Ordering::Relaxed);
        self.store
            .set_setting("notch_enabled", if enabled { "true" } else { "false" })?;
        Ok(self.status())
    }

    pub fn notch_enabled(&self) -> bool {
        self.notch_enabled.load(Ordering::Relaxed)
    }

    pub fn set_replay_mode(&self, enabled: bool) {
        self.replay_mode.store(enabled, Ordering::Relaxed);
    }
}
