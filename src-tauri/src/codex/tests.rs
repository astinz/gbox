use super::*;
use crate::codex::extraction::final_agent_text;

#[test]
fn extraction_schema_is_strict() {
    let schema = extraction::extraction_schema();
    assert_eq!(schema["additionalProperties"], Value::Bool(false));
    assert_eq!(
        schema["properties"]["claims"]["items"]["additionalProperties"],
        Value::Bool(false)
    );
    assert!(schema["properties"]["claims"]["items"]["properties"]
        .get("subject")
        .is_some());
    assert!(schema["properties"]["claims"]["items"]["properties"]
        .get("companyId")
        .is_none());
    assert_eq!(schema["properties"]["claims"]["maxItems"], 6);
    assert!(
        schema["properties"]["claims"]["items"]["properties"]["predicate"]["description"]
            .as_str()
            .is_some_and(|description| description.contains("Canonical"))
    );
}

#[test]
fn final_agent_item_can_complete_a_structured_turn() {
    let params = json!({
        "turnId": "turn-1",
        "item": {
            "type": "agentMessage",
            "phase": "final_answer",
            "text": "{\"claims\":[]}"
        }
    });
    assert_eq!(final_agent_text(&params), Some("{\"claims\":[]}"));
}

#[test]
fn version_parser_accepts_installed_shape() {
    let version = Version::parse("0.144.4").expect("version");
    assert!(version >= Version::parse(MIN_CODEX_VERSION).expect("minimum"));
}

#[test]
fn parses_jsonl_and_correlates_only_responses() {
    let response =
        parse_app_server_line(r#"{"id":7,"result":{"ok":true}}"#).expect("response frame");
    let notification =
        parse_app_server_line(r#"{"method":"future/unknown","params":{"extra":true}}"#)
            .expect("notification frame");
    assert_eq!(response_id(&response), Some(7));
    assert_eq!(response_id(&notification), None);
    assert_eq!(
        event_summary("future/unknown", &notification["params"]),
        "future · unknown"
    );
    assert!(parse_app_server_line("[]").is_err());
}

#[test]
fn normalizes_notification_thread_id_shapes() {
    assert_eq!(
        notification_thread_id(&json!({"threadId": "item-thread"})),
        Some("item-thread")
    );
    assert_eq!(
        notification_thread_id(&json!({"thread": {"id": "started-thread"}})),
        Some("started-thread")
    );
}

#[test]
fn requires_every_gbox_hook_to_be_enabled_and_trusted() {
    let trusted = json!({"data": [{"hooks": [
        {"pluginId": "gbox-control@gbox-local", "enabled": true, "trustStatus": "trusted"},
        {"pluginId": "gbox-control@gbox-local", "enabled": true, "trustStatus": "trusted"},
        {"pluginId": "gbox-control@gbox-local", "enabled": true, "trustStatus": "trusted"}
    ]}]});
    assert!(gbox_hooks_are_trusted(&trusted));
    let modified = json!({"data": [{"hooks": [
        {"pluginId": "gbox-control@gbox-local", "enabled": true, "trustStatus": "trusted"},
        {"pluginId": "gbox-control@gbox-local", "enabled": true, "trustStatus": "modified"},
        {"pluginId": "gbox-control@gbox-local", "enabled": true, "trustStatus": "trusted"}
    ]}]});
    assert!(!gbox_hooks_are_trusted(&modified));
}

#[test]
fn extracts_only_final_agent_messages() {
    assert!(!is_final_agent_message(&json!({
        "type": "agentMessage",
        "phase": "commentary",
        "text": "I will check that claim."
    })));
    assert!(is_final_agent_message(&json!({
        "type": "agentMessage",
        "phase": "final_answer",
        "text": "The source contradicts the claim."
    })));
    assert!(!is_final_agent_message(&json!({
        "type": "reasoning",
        "phase": "final_answer"
    })));
}

#[test]
fn configured_mcp_list_builds_valid_disabled_transports() {
    let configs = parse_configured_mcp_server_disable_configs(
        br#"[
          {"name":"company_data","enabled":true,"transport":{"type":"stdio","command":"node","args":["server.mjs"],"env":{"SECRET":"redacted"}}},
          {"name":"openaiDeveloperDocs","enabled":true,"transport":{"type":"streamable_http","url":"https://developers.openai.com/mcp","bearer_token_env_var":null}}
        ]"#,
    )
    .expect("MCP disable configs");
    assert_eq!(configs["company_data"]["enabled"], Value::Bool(false));
    assert_eq!(
        configs["company_data"]["command"],
        Value::String("node".to_owned())
    );
    assert!(configs["company_data"].get("env").is_none());
    assert_eq!(
        configs["openaiDeveloperDocs"]["url"],
        Value::String("https://developers.openai.com/mcp".to_owned())
    );
    assert!(!configs.contains_key("codex_apps"));
}
