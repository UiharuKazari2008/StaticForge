////////////////////////////////////////////////////////////////////////////////
//
//  clock.js
//
////////////////////////////////////////////////////////////////////////////////
var clockThemes                = new Array("101", "102", "103", "104", "105", "106", "201", "202", "203", "204", "205", "206");
var bounceDistance             = 3;
var newPositionMinutes         = 0;
var currentPositionMinutes     = 0;
var newPositionHours           = 0;
var currentPositionHours       = 0;
var curTime                    = 1;
var clockPartsWidth;
var clockPartsHeight;
var clockPartsTop;
var clockPartsLeft;
var date;
var day;
var intervalTime;
var newTimeOut;
var stopPositionHours;
var stopPositionMinutes;
var clockFont;
var clockFontColor;
var clockFontSize;
var loadAnimation = false;
////////////////////////////////////////////////////////////////////////////////
//
// load initial settings
//
////////////////////////////////////////////////////////////////////////////////
function loadMain()
{
    settingsChanged();

    System.Gadget.settingsUI = "settings.html";
    System.Gadget.onSettingsClosed = settingsClosed;
    
    System.Gadget.visibilityChanged = visibilityChanged;
    
    h.addShadow("grey", 2, 40, 2, 2);
    m.addShadow("grey", 2, 40, 2, 2);
    s.addShadow("grey", 2, 40, 2, 2);
}
////////////////////////////////////////////////////////////////////////////////
//
// set theme images
//
////////////////////////////////////////////////////////////////////////////////
function setImages()
{
    var curTheme = clockThemes[mySetting.themeID];
    
    clockBg.src = "url(images/" + curTheme + ".png)";
    
    highlights.src = "images/highlights.png";
    
    h.src = "images/h.png";
    m.src = "images/m.png";
    s.src = "images/s.png";
    dot.src = "images/dot.png";
}
////////////////////////////////////////////////////////////////////////////////
//
// calculate current time
//
////////////////////////////////////////////////////////////////////////////////
function timePerInterval()
{
    if (mySetting.timeZoneIndex != -1 && getValidTimeZone(mySetting.timeZoneIndex) != -1)
    {
        date = new Date(System.Time.getLocalTime(zones.item(mySetting.timeZoneIndex)));
    }
    else
    {
        date = new Date(System.Time.getLocalTime(System.Time.currentTimeZone));
    }
    
    with (date)
    {
        day = getDate();
        hours = getHours();
        minutes = getMinutes();
        seconds = getSeconds();
    }
    
    var rotationHours = hours;

    if (hours > 12)
    {
        rotationHours = hours - 12;
    }
    
    if (loadAnimation)
    {
        stopPositionHours = (rotationHours * 30) + (minutes / 2);
        stopPositionMinutes = (minutes * 6) + (seconds / 10);

        h.Rotation = 0;
        m.Rotation = 0;

        loadTimeMinutes(0);
        loadTimeHours(0);

        if (mySetting.secondsEnabled)
        {
            s.Rotation = 0;
            loadTimeSeconds(0);
        }
        
        loadAnimation = false;

        newTimeOut = setTimeout("timePerInterval(" + intervalTime + ")", (intervalTime * 2));
    }
    else
    {
        h.Rotation = (rotationHours * 30) + (minutes / 2);
        m.Rotation = (minutes * 6) + (seconds / 10);
        
        if (mySetting.secondsEnabled)
        {
            s.Rotation = (seconds * 6) + bounceDistance;

            setTimeout("bounceBack()", 50);
            
            var secondOffset = secondTimeOffset();
            
            if (secondOffset > 0)
            {
                newTimeOut = setTimeout("timePerInterval()", secondOffset);
            }
            else
            {
                timePerInterval();
            }
        }
        else
        {
            newTimeOut = setTimeout("timePerInterval()", 5000);
        }
    }

    if (clockDate.innerText != day && mySetting.dateEnabled)
    {
        clockDate.innerText = day;
    }

    if (curTime != minutes && mySetting.chimeEnabled)
    {
        switch (minutes)
        {
            case 0:
                PlaySound("media/" + rotationHours + ".mid");
                curTime = minutes;
                break;
            case 15:
                PlaySound("media/15.mid");
                curTime = minutes;                
                break;
            case 30:
                PlaySound("media/30.mid");
                curTime = minutes;                
                break;
            case 45:
                PlaySound("media/45.mid");
                curTime = minutes;                
                break;
            default:
                break;
        }
    }

    updateTooltip();
}
////////////////////////////////////////////////////////////////////////////////
//
//
////////////////////////////////////////////////////////////////////////////////
function visibilityChanged()
{
    if (System.Gadget.visible)
    {
        if (!newTimeOut)
        {
            loadAnimation = false;
            timePerInterval();
        }
    }
    else
    {
        clearTimeout(newTimeOut);
        newTimeOut = null;
    }
}
////////////////////////////////////////////////////////////////////////////////
//
//
////////////////////////////////////////////////////////////////////////////////
function PlaySound(url)
{
    document.all.sound.src = url;
}
////////////////////////////////////////////////////////////////////////////////
//
//
////////////////////////////////////////////////////////////////////////////////
function updateTooltip()
{
    highlights.title = clockTime.alt = date.toLocaleTimeString();
}
////////////////////////////////////////////////////////////////////////////////
//
// settings event closed
//
////////////////////////////////////////////////////////////////////////////////
function settingsClosed(event)
{
    if (event.closeAction == event.Action.commit)
    {
        settingsChanged();
    }
}
////////////////////////////////////////////////////////////////////////////////
// 
// set clock to the new settings
//
////////////////////////////////////////////////////////////////////////////////
function settingsChanged()
{
    mySetting.load();

    if (mySetting.timeZoneIndex != -1 && zonesCount == 0)
    {
        updateTimeZones();
    }

    var topPX = 58;
    var leftPX = 94;

    var curTheme = clockThemes[getValidThemeID(mySetting.themeID)];
    
    switch (curTheme)
    {
        case "101":
            clockPartsWidth = 13;
            clockPartsHeight = 129;
            clockPartsTop = 0;
            clockPartsLeft = 59;
            break;
        case "102":
            topPX = 59;
            leftPX = 93;
            clockPartsWidth = 13;
            clockPartsHeight = 129;
            clockPartsTop = 1;
            clockPartsLeft = 59;
            break;
        case "103":
            clockPartsWidth = 13;
            clockPartsHeight = 129;
            clockPartsTop = 0;
            clockPartsLeft = 58;
            break;
        case "104":
            leftPX = 93;
            clockPartsWidth = 13;
            clockPartsHeight = 129;
            clockPartsTop = 1;
            clockPartsLeft = 59;
            break;
        case "105":
            clockPartsWidth = 13;
            clockPartsHeight = 129;
            clockPartsTop = 0;
            clockPartsLeft = 59;
            break;
        case "106":
            leftPX = 97;
            clockPartsWidth = 13;
            clockPartsHeight = 129;
            clockPartsTop = 0;
            clockPartsLeft = 59;
            break;
        case "201":
            clockPartsWidth = 13;
            clockPartsHeight = 129;
            clockPartsTop = 0;
            clockPartsLeft = 59;
            break;
        case "202":
            topPX = 59;
            leftPX = 93;
            clockPartsWidth = 13;
            clockPartsHeight = 129;
            clockPartsTop = 1;
            clockPartsLeft = 59;
            break;
        case "203":
            clockPartsWidth = 13;
            clockPartsHeight = 129;
            clockPartsTop = 0;
            clockPartsLeft = 58;
            break;
        case "204":
            leftPX = 93;
            clockPartsWidth = 13;
            clockPartsHeight = 129;
            clockPartsTop = 1;
            clockPartsLeft = 59;
            break;
        case "205":
            clockPartsWidth = 13;
            clockPartsHeight = 129;
            clockPartsTop = 0;
            clockPartsLeft = 59;
            break;
        case "206":
            leftPX = 97;
            clockPartsWidth = 13;
            clockPartsHeight = 129;
            clockPartsTop = 0;
            clockPartsLeft = 59;
            break;
    }
    
    dot.style.width = h.style.width = m.style.width = s.style.width = clockPartsWidth;
    dot.style.height = h.style.height = m.style.height = s.style.height = clockPartsHeight;
    dot.style.top = h.style.top = m.style.top = s.style.top = clockPartsTop;
    dot.style.left = h.style.left = m.style.left = s.style.left = clockPartsLeft;
    
    setImages();

    if (mySetting.clockName.length > 0)
    {
        with (clockName.style)
        {
            width = "56px";
            fontFamily = "Script MT Bold";
            color = "#666666";
            fontSize = "10pt";
        }
        
        clockName.innerText = mySetting.clockName;
        clockNamePosition.style.visibility = "visible";
    }
    else
    {
        clockNamePosition.style.visibility = "hidden";
    }

    if (mySetting.dateEnabled)
    {
        with (d.style)
        {
            top = topPX + "px";
            left = leftPX + "px";
            visibility = "visible";
        }

        with (clockDatePosition.style)
        {
            top = topPX + "px";
            left = leftPX + "px";
            visibility = "visible";
        }

        with (clockDate.style)
        {
            fontFamily = "Arial";
            color = "000000";
            fontSize = "8pt";
        }
    }
    else
    {
        d.style.visibility = "hidden";
        clockDatePosition.style.visibility = "hidden";
    }

    loadAnimation = true;
    clearTimeout(newTimeOut);

    if (mySetting.secondsEnabled)
    {
        s.style.visibility = "visible";   
    }
    else
    {
        s.style.visibility = "hidden";
    }
    
    if (mySetting.glassEnabled)
    {
        highlights.style.visibility = "visible";   
    }
    else
    {
        highlights.style.visibility = "hidden";
    }
    
    timePerInterval();
}
////////////////////////////////////////////////////////////////////////////////
//
// makes second hand bounce
//
////////////////////////////////////////////////////////////////////////////////
function bounceBack()
{
    s.Rotation = s.Rotation - bounceDistance;
}
////////////////////////////////////////////////////////////////////////////////
//
//
////////////////////////////////////////////////////////////////////////////////
function secondTimeOffset()
{
    return 1000 - (new Date().getTime() % 1000);
}
////////////////////////////////////////////////////////////////////////////////
//
// animates rotation of minutes hand on load
//
////////////////////////////////////////////////////////////////////////////////
function loadTimeSeconds(currentPositionSeconds)
{
    var distanceSeconds = (seconds * 6 ) - currentPositionSeconds;

    if (currentPositionSeconds < ((seconds * 6) - 2))
    {
        newPositionSeconds = currentPositionSeconds + (distanceSeconds / 10);
        s.Rotation = newPositionSeconds;

        setTimeout("loadTimeSeconds(" + newPositionSeconds + ")", 20);
    }
    else
    {
        loadAnimation = false;
        s.Rotation = seconds * 6;
    }
}
////////////////////////////////////////////////////////////////////////////////
//
// animates rotation of minutes hand on load
//
////////////////////////////////////////////////////////////////////////////////
function loadTimeMinutes(currentPositionMinutes)
{
    var distanceMinutes = stopPositionMinutes - currentPositionMinutes;
    
    if (currentPositionMinutes < (stopPositionMinutes - 1))
    {
        newPositionMinutes = currentPositionMinutes + (distanceMinutes / 10);
        m.Rotation = newPositionMinutes;

        setTimeout("loadTimeMinutes(" +newPositionMinutes + ")", 20);
    }
    else
    {
        loadAnimation = false;
        m.Rotation = stopPositionMinutes;
    }
} 
////////////////////////////////////////////////////////////////////////////////
//
// animates rotation of hours hand on load
//
////////////////////////////////////////////////////////////////////////////////
function loadTimeHours(currentPositionHours)
{
    var distanceHours = stopPositionHours - currentPositionHours;

    if (currentPositionHours < (stopPositionHours - 1))
    {
        newPositionHours = currentPositionHours + (distanceHours / 10);
        h.Rotation = newPositionHours;

        setTimeout("loadTimeHours(" + newPositionHours + ")", 20);
    }
    else
    {
        loadAnimation = false;
        h.Rotation = stopPositionHours;
    }
}
