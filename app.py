#!/usr/bin/env python3
"""Streaming web frontend to traceroute"""
import logging
import os
import subprocess

import flask

from streamedprocess import StreamedSubprocess

app = flask.Flask(__name__)
streamedprocess = StreamedSubprocess()

logger = logging.getLogger('webtraceroute')
logging.basicConfig(level=logging.DEBUG)

TIMEOUT = int(os.environ.get('WEBTRACE_TIMEOUT', 30))

def render_error(error_str=None):
    return flask.render_template('error.html.j2', error=error_str)

@app.route("/")
def index():
    return flask.render_template('index.html.j2')

def get_trace_command(target):
    if os.name == 'nt':
        return ['tracert', target]
    return ['traceroute', '--', target]

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

@app.route("/trace")
def trace():
    if target := flask.request.args.get('target'):
        cmd = get_trace_command(target)
        return run_streamed_process(cmd), {"Content-Type": "text/plain"}
    return 'ERROR: No traceroute target specified', 400

@app.route('/static/<path:path>')
def render_static(path):
    return flask.send_from_directory('static', path)

if __name__ == '__main__':
    print('This is a Flask webapp, use `flask run` instead for testing')
