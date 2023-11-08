#!/usr/bin/env python3
"""Streaming web frontend to traceroute"""
import logging
import os

import flask

import traceroute

app = flask.Flask(__name__)
traceroute_wrapper = traceroute.TracerouteWrapper()

logger = logging.getLogger('webtraceroute')
logging.basicConfig(level=logging.DEBUG)

TIMEOUT = int(os.environ.get('WEBTRACEROUTE_TIMEOUT', 30))

def render_error(error_str=None):
    return flask.render_template('error.html.j2', error=error_str)

@app.route("/")
def index():
    return flask.render_template('index.html.j2')

def stream_traceroute(target):
    try:
        for line in traceroute_wrapper.traceroute(target, timeout=TIMEOUT):
            yield line
    except traceroute.TracerouteTimedOutError as e:
        logger.exception(e)
        yield f'\nTIMEOUT: {e}'
    except traceroute.TracerouteError as e:
        logger.exception(e)
        yield f'\nERROR: {e}'

@app.route("/trace")
def trace():
    if target := flask.request.args.get('target'):
        return stream_traceroute(target), {"Content-Type": "text/plain"}
    return 'ERROR: No traceroute target specified', 400

@app.route('/static/<path:path>')
def render_static(path):
    return flask.send_from_directory('static', path)

if __name__ == '__main__':
    print('This is a Flask webapp, use `flask run` instead for testing')
