package password

// HoldSlots takes every slot h has, as that many hashes in flight would, and returns what gives
// them back.
func (h *Hasher) HoldSlots() (release func()) {
	for range cap(h.slots) {
		h.slots <- struct{}{}
	}
	return func() {
		for range cap(h.slots) {
			<-h.slots
		}
	}
}
