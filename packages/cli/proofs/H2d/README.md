# Share-service shutdown

Prepared on fc743e7. No crypto, feed, descriptor, or wire-payload changes.

Run `pnpm exec vitest run packages/cli/test/share-service.test.ts --maxWorkers=1`.
The regression uses an explicitly labelled loopback GitHub stub and a process
Comb fixture. SSH verification is real. It opens an authenticated SSE connection,
starts a 250 ms delayed append, and stops the service while that append is
running. The old code returns 502 by killing Comb immediately. The fixed code
returns 200, closes SSE with a clean event and EOF within two seconds, restarts
on the same port, obtains a fresh token, reconnects SSE, and checks the durable
feed still contains the append. A separate stuck 30-second append verifies the
shutdown deadline falls between 4.9 and 6.5 seconds and concurrent close calls
share the same result.

The subprocess regression runs the actual CLI twice, sends actual SIGTERM with
SSE open, and verifies exit code 0, no signal death, stop under two seconds,
clean close event/EOF and successful same-port restart. The original plain-SSE
subprocess also exited promptly locally: its captured failure is the missing
close event. We have not reproduced the remote 45-second stall with plain SSE
alone and do not claim its precise cause is proven. The explicit deadline also
covers incomplete requests and sockets that cannot drain normally.

Full focused suite: 91 tests in 21 share/sync files, with --maxWorkers=1.
Typecheck passes. H3's actual netcup systemd stop/restart remains the deployment
acceptance check, owned by a10af6c4. H3 confirmed its pinned fc743e7 drill complete before this follow-up was
committed. Its earlier evidence remains attributed to that build.
