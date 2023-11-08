#!/usr/bin/env python3
"""Traceroute wrapper with timeout handling and streaming subprocess input"""

import argparse
import dataclasses
import logging
import subprocess
import threading
import time

class TracerouteError(Exception):
    def __init__(self, message, returncode=None):
        super().__init__(message)
        self.returncode = returncode

class TracerouteTimedOutError(TracerouteError):
    pass

@dataclasses.dataclass
class WatchedProcess:
    """Container for a subprocess, plus its timeout status"""
    proc: subprocess.Popen
    timed_out: bool = False

    def __hash__(self):
        return hash(self.proc)

logger = logging.getLogger('webtraceroute')

class TracerouteWrapper():
    """Traceroute wrapper with timeout handling and streaming subprocess input"""
    def __init__(self):
        self._timeout_thread = None
        self._timeout_procs = {}

    def _watch_proc_timeout(self):
        while self._timeout_procs:
            for watched_process, timeout_ts in list(self._timeout_procs.items()):
                proc = watched_process.proc
                if time.time() > timeout_ts:
                    logger.debug('Terminating %s due to timeout', proc.pid)
                    proc.terminate()
                    watched_process.timed_out = True
                    del self._timeout_procs[watched_process]
                if proc.returncode is not None:
                    logger.debug('Removing exited process %s', proc.pid)
                    del self._timeout_procs[watched_process]
            time.sleep(0.1)
        logger.debug('Stopping _watch_proc_timeout thread')

    def _add_watched_process(self, watched_process: WatchedProcess, timeout: float):
        """Add a Process to be killed when the timeout expires"""
        timeout_ts = time.time() + timeout
        logger.debug('Watching process %s with timeout %s', watched_process.proc.pid, timeout_ts)
        self._timeout_procs[watched_process] = timeout_ts
        if not self._timeout_thread or not self._timeout_thread.is_alive():
            logger.debug('Starting _watch_proc_timeout thread')
            self._timeout_thread = threading.Thread(
                target=self._watch_proc_timeout, daemon=True
            )
            self._timeout_thread.start()

    def traceroute(self, target, timeout=30):
        """
        Traceroute, with lines generated as they are read from the subprocess
        """
        args = ['traceroute', '--', target]
        with subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            encoding='utf-8') as process:
            watchedProcess = WatchedProcess(process)
            self._add_watched_process(watchedProcess, timeout)
            yield from process.stdout
            # Give traceroute some time to exit before checking its exit status
            process.wait(1)
            logger.debug('Trace finished, exit code is %s', process.returncode)
            if process.returncode:
                if watchedProcess.timed_out:
                    raise TracerouteTimedOutError('traceroute timed out', process.returncode)
                raise TracerouteError(f'traceroute exited with code {process.returncode}', process.returncode)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('target')
    parser.add_argument('-t', '--timeout', type=int, default=30)
    parser.add_argument('-v', '--verbose', action='store_true')
    args = parser.parse_args()

    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO)

    t = TracerouteWrapper()
    for line in t.traceroute(args.target, timeout=args.timeout):
        print(line, end='')

if __name__ == '__main__':
    main()
