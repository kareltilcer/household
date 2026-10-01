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

// killed reports whether the command exited describes ended by SIGKILL. The converter sends it only
// when a conversion runs out of time or its client leaves, which the caller has told apart first, so
// any other is the system's: the kernel's, for the memory the command took. A command that crashes
// on what it read, SIGSEGV or SIGABRT, ended by the document, is not killed.
func killed(exited *exec.ExitError) bool {
	status, ok := exited.Sys().(syscall.WaitStatus)
	return ok && status.Signaled() && status.Signal() == syscall.SIGKILL
}
