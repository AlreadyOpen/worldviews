#!/bin/sh
# Capture one option set: ./shoot.sh <name> "<query>" [width height]. Waits for window.__ready, prints __state.
export AGENT_BROWSER_SESSION=${AGENT_BROWSER_SESSION:-wv}
agent-browser set viewport "${3:-1440}" "${4:-900}" >/dev/null 2>&1
agent-browser open "http://127.0.0.1:8760/?$2" >/dev/null
agent-browser eval "new Promise(r=>{let i=0;const t=setInterval(()=>{if(window.__ready||++i>180){clearInterval(t);r(JSON.stringify({ready:!!window.__ready,s:window.__state&&{switch:__state.switch,view:__state.view,theme:__state.appliedTheme,camera:__state.camera}}))}},500)})"
sleep "${WAIT:-1}"
agent-browser screenshot "shots/$1.png" >/dev/null && echo "shots/$1.png"
