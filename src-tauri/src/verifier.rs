use anyhow::{Context, Result};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use std::str::FromStr;

use crate::domain::{ClaimCandidate, ClaimState, CompanyMetricRecord};
use crate::store::sha256_hex;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerificationOutcome {
    pub state: ClaimState,
    pub confidence: f64,
    pub record: Option<CompanyMetricRecord>,
    pub result_hash: String,
    pub explanation: String,
}

pub fn verify_candidate(
    candidate: &ClaimCandidate,
    record: Option<CompanyMetricRecord>,
    source_error: Option<&str>,
) -> VerificationOutcome {
    let Some(company_id) = candidate.subject.as_deref() else {
        return unverifiable(record, "The claim does not identify a subject.");
    };
    let Some(metric) = candidate.predicate.as_deref() else {
        return unverifiable(record, "The claim does not identify a predicate.");
    };
    let Some(period) = candidate.temporal_context.as_deref() else {
        return unverifiable(record, "The claim does not identify a temporal context.");
    };
    let Some(asserted_value) = candidate.asserted_value.as_deref() else {
        return unverifiable(record, "The claim does not contain a comparable value.");
    };
    let Some(unit) = candidate.unit.as_deref() else {
        return unverifiable(record, "The claim does not identify a unit.");
    };

    if let Some(error) = source_error {
        return unverifiable(record, &format!("Company MCP lookup failed: {error}"));
    }
    let Some(record) = record else {
        return unverifiable(None, "No authoritative company record matched the claim.");
    };

    if normalize(company_id) != normalize(&record.company_id)
        || normalize(metric) != normalize(&record.metric)
        || !period.trim().eq_ignore_ascii_case(record.period.trim())
    {
        return unverifiable(
            Some(record),
            "The returned record does not match the claim identity.",
        );
    }
    if normalize_unit(unit) != normalize_unit(&record.unit) {
        return unverifiable(
            Some(record),
            "The claim and authoritative record use incompatible units.",
        );
    }

    let asserted = Decimal::from_str(asserted_value.trim());
    let authoritative = Decimal::from_str(record.value.trim());
    let (Ok(asserted), Ok(authoritative)) = (asserted, authoritative) else {
        return unverifiable(
            Some(record),
            "The claim or authoritative record has a non-decimal value.",
        );
    };
    let result_hash = record_hash(&record);
    if asserted == authoritative {
        VerificationOutcome {
            state: ClaimState::Verified,
            confidence: 1.0,
            explanation: format!(
                "The company record confirms {} {} for {}.",
                record.value, record.unit, record.period
            ),
            record: Some(record),
            result_hash,
        }
    } else {
        VerificationOutcome {
            state: ClaimState::Contradicted,
            confidence: 1.0,
            explanation: format!(
                "The claim states {asserted_value} {unit}, but the company record contains {} {}.",
                record.value, record.unit
            ),
            record: Some(record),
            result_hash,
        }
    }
}

pub fn seed_records() -> Result<Vec<CompanyMetricRecord>> {
    serde_json::from_str(include_str!("../../fixtures/company-records.json"))
        .context("seeded company records are invalid")
}

pub fn find_seed_record(candidate: &ClaimCandidate) -> Result<Option<CompanyMetricRecord>> {
    let (Some(company_id), Some(metric), Some(period)) = (
        candidate.subject.as_deref(),
        candidate.predicate.as_deref(),
        candidate.temporal_context.as_deref(),
    ) else {
        return Ok(None);
    };
    Ok(seed_records()?.into_iter().find(|record| {
        normalize(&record.company_id) == normalize(company_id)
            && normalize(&record.metric) == normalize(metric)
            && record.period.eq_ignore_ascii_case(period)
    }))
}

fn unverifiable(record: Option<CompanyMetricRecord>, explanation: &str) -> VerificationOutcome {
    let result_hash = record
        .as_ref()
        .map(record_hash)
        .unwrap_or_else(|| sha256_hex(explanation.as_bytes()));
    VerificationOutcome {
        state: ClaimState::Unverifiable,
        confidence: 0.0,
        record,
        result_hash,
        explanation: explanation.to_owned(),
    }
}

fn normalize(value: &str) -> String {
    value.trim().to_ascii_lowercase().replace([' ', '-'], "_")
}

fn normalize_unit(value: &str) -> String {
    match value.trim().to_ascii_lowercase().as_str() {
        "$" | "usd" | "us dollars" | "dollars" => "usd".to_owned(),
        "users" | "customers" | "count" => "count".to_owned(),
        other => other.to_owned(),
    }
}

fn record_hash(record: &CompanyMetricRecord) -> String {
    sha256_hex(serde_json::to_string(record).unwrap_or_default().as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn candidate(value: Option<&str>, metric: Option<&str>) -> ClaimCandidate {
        ClaimCandidate {
            statement: "Acme production database users in 2026-Q2".to_owned(),
            claim_type: "quantity".to_owned(),
            subject: Some("acme".to_owned()),
            predicate: metric.map(str::to_owned),
            object: Some("production database users".to_owned()),
            asserted_value: value.map(str::to_owned),
            unit: Some("count".to_owned()),
            temporal_context: Some("2026-Q2".to_owned()),
            location: None,
            source_span: "production database users".to_owned(),
        }
    }

    #[test]
    fn produces_all_three_states() {
        let verified_candidate = candidate(Some("17"), Some("production_database_users"));
        let record = find_seed_record(&verified_candidate)
            .expect("lookup")
            .expect("record");
        assert_eq!(
            verify_candidate(&verified_candidate, Some(record.clone()), None).state,
            ClaimState::Verified
        );
        assert_eq!(
            verify_candidate(
                &candidate(Some("42"), Some("production_database_users")),
                Some(record),
                None
            )
            .state,
            ClaimState::Contradicted
        );
        assert_eq!(
            verify_candidate(&candidate(Some("3"), Some("untracked_metric")), None, None).state,
            ClaimState::Unverifiable
        );
    }
}
