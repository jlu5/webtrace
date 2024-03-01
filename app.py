#!/usr/bin/env python3
"""Streaming web frontend to traceroute"""
import logging
import os
import shutil
import subprocess

import flask
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

from streamedprocess import StreamedSubprocess

app = flask.Flask(__name__)

streamedprocess = StreamedSubprocess()

logger = logging.getLogger('webtrace')
logging.basicConfig(level=logging.DEBUG)

MTR_COUNT = int(os.environ.get('WEBTRACE_MTRCOUNT', 10))
PING_COUNT = int(os.environ.get('WEBTRACE_PINGCOUNT', 4))
RATELIMIT = os.environ.get('WEBTRACE_RATELIMIT', "10/minute")
SERVERINFO = os.environ.get('WEBTRACE_SERVERINFO')
TITLE = os.environ.get('WEBTRACE_TITLE', 'webtrace')
TIMEOUT = int(os.environ.get('WEBTRACE_TIMEOUT', 30))

limiter = Limiter(
    get_remote_address,
    app=app,
    default_limits=[RATELIMIT],
    storage_uri="memory://",
)

try:
    version_git = subprocess.check_output(['git', 'rev-parse', 'HEAD'], encoding='utf-8').strip()
except subprocess.CalledProcessError:
    version_git = None

@app.route("/")
@limiter.exempt
def index():
    return flask.render_template(
        'index.html.j2',
        page_title=TITLE,
        serverinfo=SERVERINFO,
        version_git=version_git)

def run_streamed_process(target):
    try:
        for line in streamedprocess.run(target, timeout=TIMEOUT):
            yield line
    except subprocess.TimeoutExpired as e:
        logger.exception(e)
        yield f'\nTIMEOUT: {e.cmd[0]} timed out'
    except subprocess.CalledProcessError as e:
        logger.exception(e)
        yield f'\nERROR: {e.cmd[0]} exited with status {e.returncode}'

def get_trace_command(target):
    if os.name == 'nt':
        return ['tracert', target]
    return ['traceroute', '--', target]

def get_ping_command(target):
    if os.name == 'nt':
        return ['ping', '-n', str(PING_COUNT), target]
    return ['ping', '-c', str(PING_COUNT), '--', target]

def get_mtr_command(target):
    return ['mtr', '-p', '-b', '-c', str(MTR_COUNT), '--', target]

def _handle_url(get_command_func):
    if target := flask.request.args.get('target'):
        cmd = get_command_func(target)
        if not shutil.which(cmd[0]):
            return f'ERROR: {cmd[0]} is not available on this server', 422
        return run_streamed_process(cmd), {"Content-Type": "text/plain"}
    return 'ERROR: No target specified', 400

@app.route("/trace")
def trace():
    return _handle_url(get_trace_command)

@app.route("/ping")
def ping():
    return _handle_url(get_ping_command)

@app.route("/mtr")
def mtr():
    return _handle_url(get_mtr_command)

@app.route('/static/<path:path>')
@limiter.exempt
def render_static(path):
    return flask.send_from_directory('static', path)

if __name__ == '__main__':
    print('This is a Flask webapp, use `flask run` instead for testing')
