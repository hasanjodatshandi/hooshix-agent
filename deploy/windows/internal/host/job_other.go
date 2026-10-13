//go:build !windows

package host

// jobObject has no counterpart off Windows. The supervisor still runs there —
// that is how these tests execute — it simply has no kernel-backed
// kill-with-the-parent guarantee.
type jobObject struct{}

func createKillOnCloseJob() (*jobObject, error) { return nil, nil }

func (job *jobObject) assign(int) error { return nil }

func (job *jobObject) close() {}
