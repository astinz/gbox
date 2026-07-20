use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

use anyhow::Result;

use crate::{
    codex::CodexSupervisor,
    domain::{DashboardSnapshot, SystemStatus},
    gate::ActionGate,
    store::Store,
};

pub struct ApplicationState {
    pub store: Arc<Store>,
    pub codex: Arc<CodexSupervisor>,
    pub gate: Arc<ActionGate>,
    replay_mode: AtomicBool,
    global_observation: AtomicBool,
}

impl ApplicationState {
    pub fn new(store: Arc<Store>, codex: Arc<CodexSupervisor>, gate: Arc<ActionGate>) -> Arc<Self> {
        let global_observation = store
            .get_setting("global_observation")
            .ok()
            .flatten()
            .is_some_and(|value| value == "true");
        Arc::new(Self {
            store,
            codex,
            gate,
            replay_mode: AtomicBool::new(false),
            global_observation: AtomicBool::new(global_observation),
        })
    }

    pub fn status(&self) -> SystemStatus {
        let mut status = self.codex.status();
        status.global_observation = self.global_observation.load(Ordering::Relaxed);
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

    pub fn set_replay_mode(&self, enabled: bool) {
        self.replay_mode.store(enabled, Ordering::Relaxed);
    }
}
