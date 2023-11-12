const _SPINNER_VALUES = ['|', '/', '-', '\\'];
let spinnerCount = 0;
const updateWorkingStatus = () => {
    console.debug('updateWorkingStatus running...');
    spinnerCount++;
    spinnerCount %= _SPINNER_VALUES.length;
    const status = document.getElementById("status");
    status.innerText = `Working ${_SPINNER_VALUES[spinnerCount]}`;
}
let activeLoop = null;

function stopTrace(updateStatus) {
    if (activeLoop) {
        console.debug(`Clearing old trace loop ${activeLoop}`);
        clearInterval(activeLoop);
        activeLoop = null;
        if (updateStatus) {
            const status = document.getElementById("status");
            status.classList = "status-error";
            status.innerText = "Aborted";
        }
    }
}

async function runTrace() {
    stopTrace(false);
    const output = document.getElementById("output");
    const status = document.getElementById("status");
    const target = document.getElementById("target_input").value;
    console.debug(`Starting trace to ${target}`);

    const action = document.querySelector('input[name="action"]:checked');
    if (!action) {
        status.classList = "status-error";
        status.innerText = `ERROR: No action specified`;
        return;
    }

    const response = await fetch(`/${action.value}?target=${encodeURIComponent(target)}`)

    if (!response.ok) {
        traceFinished = true;
        status.classList = "status-error";
        status.innerText = `ERROR: ${response.status} ${response.statusText}`;
        return;
    }
    output.innerText = "";

    status.classList = "status-working";
    status.innerText = "Working";
    const thisLoop = activeLoop = setInterval(updateWorkingStatus, 200);

    for await (const buf of response.body) {
        if (activeLoop != thisLoop) {
            console.debug(`Stopping old trace loop ${thisLoop} for ${target}`);
            return;
        }
        output.innerText += String.fromCharCode(...buf);
    }
    clearInterval(activeLoop);
    if (output.innerText.includes('ERROR:')) {
        status.classList = "status-error";
        status.innerText = "Error";
    } else if (output.innerText.includes('TIMEOUT:')) {
        status.classList = "status-error";
        status.innerText = "Timeout";
    } else {
        status.classList = "status-done";
        status.innerText = "Finished";
    }
    activeLoop = null;
}

async function onInputKeyPress(event) {
    if (event.keyCode == 13) {
        await runTrace();
    }
}

async function doInit() {
    const urlParams = new URLSearchParams(window.location.search);
    const target = urlParams.get('target');
    if (target) {
        const targetInput = document.getElementById("target_input");
        targetInput.value = target;
        await runTrace();
    }
}
