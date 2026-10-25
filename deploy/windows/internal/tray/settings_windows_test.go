//go:build windows

package tray

import "testing"

func TestWindowsSettingsURLAcceptsOnlyHTTPSOrigin(t *testing.T) {
	got, err := settingsPageURL("https://mcp.example.test")
	if err != nil || got != "https://mcp.example.test/operator/settings" {
		t.Fatalf("url=%q err=%v", got, err)
	}
	for _, s := range []string{"https://mcp.hooshix-agent.ir", "https://mcp.hooshix-agent.ir/", "https://MCP.HOOSHIX-AGENT.IR", "https://mcp.hooshix-agent.ir:443", "http://127.0.0.1:3001", "javascript:alert(1)", "https://user:pass@example.test", "https://example.test/other", "https://example.test/?token=abc", "file:///C:/private", ""} {
		if got, err := settingsPageURL(s); err == nil {
			t.Fatalf("unsafe URL accepted %q => %q", s, got)
		}
	}
}
