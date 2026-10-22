//go:build !linux

package wslfs

import (
	"errors"
	"os"
)

func secureRootGitCheckout(_ *os.Root, _ string) (Response, error) {
	return Err("wslgit_checkout_requires_linux"), errors.New("Linux Git provider required")
}
