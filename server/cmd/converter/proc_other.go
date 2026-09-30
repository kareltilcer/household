//go:build !unix

package main

import "os/exec"

// killGroup leaves cmd as it is: the converter runs in a Linux container, and elsewhere only its
// tests run it, whose commands start no process of their own.
func killGroup(*exec.Cmd) {}

// killed reports false: elsewhere than on Linux a process the system ends ends with a code, never by
// a signal the converter could tell from the document's failure.
func killed(*exec.ExitError) bool { return false }
