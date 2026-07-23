# workflow/ map

Workflow discovery, validation, persistence, settings, launch preparation, and status projection. Keep this layer independent of Pi command and TUI wiring.

Persist live-session run records and model-call checkpoints under the session's `/tmp/pi-looporch` run directory. Resume the same run ID with the original input and current workflow source.
