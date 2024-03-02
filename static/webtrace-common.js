async function onInputKeyPress(event) {
    if (event.keyCode == 13) {
        await runTrace();
    }
}

function maybeUpdateHistory(newAction, newTarget) {
    // Update the history with the current action & target if it's different
    const urlParams = new URLSearchParams(window.location.search);
    const currTarget = urlParams.get('target');
    const currAction = urlParams.get('action');
    if (currTarget != newTarget || currAction != newAction) {
        const newState = {action: newAction, target: newTarget};
        const newParams = new URLSearchParams(newState);
        history.pushState(newState, '', `?${newParams.toString()}`);
    }
}

async function doInit() {
    const urlParams = new URLSearchParams(window.location.search);
    const target = urlParams.get('target');
    const action = urlParams.get('action');
    if (action) {
        for (const radioBtn of document.querySelectorAll('input[name="action"]')) {
            radioBtn.checked = radioBtn.value == action.toLowerCase();
        }
    }
    if (target) {
        const targetInput = document.getElementById("target_input");
        targetInput.value = target;
        await runTrace();
    }
}
