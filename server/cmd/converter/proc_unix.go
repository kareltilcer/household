//go:build unix

package main

import (
	"os/exec"
	"syscall"
)

// killGroup runs cmd in a process group of its own, and has its timeout kill the whole group:
// LibreOffice starts a process of its own, which killing soffice alone would leave running.
func killGroup(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error { return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL) }
}
