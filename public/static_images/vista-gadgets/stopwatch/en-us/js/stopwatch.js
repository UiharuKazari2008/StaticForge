var startDate;
var isRunning = false;
var isPaused = false;

function loadMain()
{
    timeDisplay.value = "00:00:00.000";
    status.innerHTML = "";
}

function onStop()
{
    if (isRunning == true)
    {
        // stop, but leave the current time in the display
        isRunning = false;
        isPaused = false;
    }
    else
    {
        // clear the display
        timeDisplay.value = "00:00:00.000";
    }
}

function onPlay()
{
    if (isRunning == false)
    {
        // start!
        isRunning = true;
        isPaused = false;
        startDate = new Date();
        setTimeout(tick, 0);
    }
    else
    {
        // paused
        if (isPaused == true)
        {
            // get going again
            isPaused = false;
            setTimeout(tick, 0);
        }
        else
        {
            // pause
            isPaused = true;
        }
    }
}

function tick()
{
    if (isRunning == true && isPaused == false)
    {
        // diff the date
        var now = new Date();
        var totalMs = now.valueOf() - startDate.valueOf();

        var h = Math.floor(totalMs / 3600000); // milliseconds in an hour
        var buff = totalMs % 3600000;

        var m = Math.floor(buff / 60000); // milliseconds in a minute
        buff = buff % 60000;

        var s = Math.floor(buff / 1000); // milliseconds in a second
        var ms = buff % 1000;

        // update the date
        var hStr = (h < 10) ? "0" + h.toString() : h.toString();
        var mStr = (m < 10) ? "0" + m.toString() : m.toString();
        var sStr = (s < 10) ? "0" + s.toString() : s.toString();
        var msStr = (ms < 100) ? ((ms < 10) ? "00" + ms.toString() : "0" + ms.toString()) : ms.toString();

        timeDisplay.value = hStr + ":" + mStr + ":" + sStr + "." + msStr;

        // do it again later
        setTimeout(tick, 10);
    }
}

function onStopStatus()
{
    var s = document.getElementById("status");
    if (isRunning == true)
    {
        s.innerHTML = "Stop";
    }
    else
    {
        s.innerHTML = "Clear";
    }
    s = null;

    stopImg.src = "images/stop_over.png";
}

function offStopStatus()
{
    var s = document.getElementById("status");
    s.innerHTML = "";
    s = null;

    stopImg.src = "images/stop.png";
}

function onPlayStatus()
{
    var s = document.getElementById("status");
    if (isRunning == true)
    {
        if (isPaused == true)
        {
            s.innerHTML = "Continue";
        }
        else
        {
            s.innerHTML = "Pause";
        }
    }
    else
    {
        s.innerHTML = "Start";
    }
    s = null;

    playImg.src = "images/play_over.png";
}

function offPlayStatus()
{
    var s = document.getElementById("status");
    s.innerHTML = "";
    s = null;
    
    playImg.src = "images/play.png";
}

