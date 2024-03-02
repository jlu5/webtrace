async function runTrace() {
    const selectedAction = document.querySelector('input[name="action"]:checked');
    if (!selectedAction) {
        console.error("No action specified");
        return;
    }
    const targetInput = document.getElementById("target_input");
    if (!targetInput.value) {
        console.error("No target specified");
        return;
    }
    for (let iframe of document.getElementsByClassName('webtrace-backend')) {
        let url = new URL(iframe.dataset.baseurl);
        url.searchParams.set('embed', 1);
        url.searchParams.set('action', selectedAction.value);
        url.searchParams.set('target', targetInput.value);
        iframe.src = url;
    }
    maybeUpdateHistory(selectedAction.value, targetInput.value);
}
