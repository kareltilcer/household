//go:build !unix

package main

import "os/exec"

// killGroup leaves cmd as it is: the converter runs in a Linux container, and elsewhere only its
// tests run it, whose commands start no process of their own.
func killGroup(*exec.Cmd) {}
