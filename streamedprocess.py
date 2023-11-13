#!/usr/bin/env python3
"""Stream the output of a subprocess with timeout handling"""

import argparse
import dataclasses
import logging
import subprocess
import threading
import time

@dataclasses.dataclass
class StreamedSubprocessStatus:
    """Container for a subprocess, plus its timeout status"""
    proc: subprocess.Popen
    timed_out: bool = False

    def __hash__(self):
        return hash(self.proc)

logger = logging.getLogger('StreamedSubprocess')

class StreamedSubprocess():
    def __init__(self):
        self._timeout_thread = None
        self._timeout_procs = {}

    def _watch_proc_timeout(self):
        while self._timeout_procs:
            for streamed_process, timeout_ts in list(self._timeout_procs.items()):
                proc = streamed_process.proc
                if time.time() > timeout_ts:
                    logger.debug('Terminating %s due to timeout', proc.pid)
                    proc.terminate()
                    streamed_process.timed_out = True
                    del self._timeout_procs[streamed_process]
                if proc.returncode is not None:
                    logger.debug('Removing exited process %s', proc.pid)
                    del self._timeout_procs[streamed_process]
            time.sleep(0.1)
        logger.debug('Stopping _watch_proc_timeout thread')

    def _add_process(self, streamed_process: StreamedSubprocessStatus, timeout: float):
        """Add a Process to be killed when the timeout expires"""
        timeout_ts = time.time() + timeout
        logger.debug('Watching process %s with timeout %s', streamed_process.proc.pid, timeout_ts)
        self._timeout_procs[streamed_process] = timeout_ts
        if not self._timeout_thread or not self._timeout_thread.is_alive():
            logger.debug('Starting _watch_proc_timeout thread')
            self._timeout_thread = threading.Thread(
                target=self._watch_proc_timeout, daemon=True
            )
            self._timeout_thread.start()

    def run(self, cmd, timeout=30):
        """
        Run a command, with lines generated as they are read from the subprocess
        """
        with subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, stdin=subprocess.PIPE,
                              encoding='utf-8') as process:
            proc_status = StreamedSubprocessStatus(process)
            self._add_process(proc_status, timeout)
            yield from process.stdout
            # Give the subprocess some time to exit before checking its exit status
            process.wait(1)
            logger.debug('Process finished, exit code is %s', process.returncode)
            if process.returncode:
                if proc_status.timed_out:
                    raise subprocess.TimeoutExpired(cmd, timeout)
                raise subprocess.CalledProcessError(process.returncode, cmd)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('target')
    parser.add_argument('-t', '--timeout', type=int, default=30)
    parser.add_argument('-v', '--verbose', action='store_true')
    args = parser.parse_args()

    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO)

    t = StreamedSubprocess()
    cmd = ['traceroute', '--', args.target]
    for line in t.run(cmd, timeout=args.timeout):
        print(line, end='')

if __name__ == '__main__':
    main()
