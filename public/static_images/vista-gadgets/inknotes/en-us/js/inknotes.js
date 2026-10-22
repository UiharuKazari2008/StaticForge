////////////////////////////////////////////////////////////////////////////////
//
//  THIS CODE IS NOT APPROVED FOR USE IN/ON ANY OTHER UI ELEMENT OR PRODUCT COMPONENT.
//  Copyright (c) 2006 Microsoft Corporation.  All rights reserved.
//
////////////////////////////////////////////////////////////////////////////////
var gadgetArray         = new Array();

var L_YELLOW_TEXT        = "Yellow";
var L_PURPLE_TEXT        = "Purple";
var L_BLUE_TEXT          = "Blue";
var L_GREEN_TEXT         = "Green";
var L_PINK_TEXT          = "Pink";
var L_WHITE_TEXT         = "White";
var L_colorArray         = new Array(L_YELLOW_TEXT, L_PURPLE_TEXT, L_BLUE_TEXT, L_GREEN_TEXT, L_PINK_TEXT, L_WHITE_TEXT);

var L_DELETENOTE_TEXT    = "Delete";
var L_PREVIOUSNOTE_TEXT  = "Previous";
var L_NEXTNOTE_TEXT      = "Next";
var L_ADDNOTE_TEXT       = "Add";

var colorHexArray        = new Array(0xB0FBFF, 0xFFCBC6, 0xFFF3CF, 0xC6FBC6, 0xFFC3FF, 0xFBFBFB);
var colorArray           = new Array("yellow", "purple", "blue", "green", "pink", "white");
var bgImgDockState       = "_docked";
var curId                = 0;
var lastId               = 0;
var totalId              = 0;
var maxNumberNotes       = 10;
var curColor;
var curSizeUndocked;
var curSizeDocked;
var curCount;
var settingsColor;
var settingsSize;
var initFlag;
var areaFocus            = false;
var bodyFocus            = false;
var textAreaFocus        = false;
var pageDir;
////////////////////////////////////////////////////////////////////////////////
//
// gadget initial startup routine
//
////////////////////////////////////////////////////////////////////////////////
function loadMain()
{
    pageDir = document.getElementsByTagName("html")[0].dir;
    
    if (System.Gadget.Settings.read("SettingsExist"))
    {
        curId = 0;
        curColor = getValidSetting(System.Gadget.Settings.readString("ColorSaved"), colorArray, 0);
    }
    else
    {
        curColor = colorArray[0];
        addNote();
    }


    System.Gadget.onDock = checkStateReload;
    System.Gadget.onUndock = checkStateReload;
    
    System.Gadget.settingsUI = "settings.html";
    System.Gadget.onSettingsClosed = settingsClosed;
    
    setImages(curColor);
    checkImageState();
    checkState();
    
    deleteIcon.alt = L_DELETENOTE_TEXT;
    leftArrow.alt = L_PREVIOUSNOTE_TEXT;
    rightArrow.alt = L_NEXTNOTE_TEXT;
    plusIcon.alt = L_ADDNOTE_TEXT;

    
    window.setTimeout("loadSaved();", 1000);
}
////////////////////////////////////////////////////////////////////////////////
//
// SETTINGS
// load settings - populate form 
//
////////////////////////////////////////////////////////////////////////////////
function loadSaved()
{
    curCount = 1;
    
    if (System.Gadget.Settings.read("NoteCount"))
    {
        curCount = getNoteCount();
    }
    
    var loadedFromReload = false;
    
    if (!gadgetArray[0])
    {
        loadedFromReload = true;
    }
    
    for (var i = 0; i < curCount; i++)
    {
        if (loadedFromReload)
        {
            gadgetArray.push(new setNote());
        }
        
        gadgetArray[i].oNoteISFString = getSettings(i);
        gadgetArray[i].oId = i;
        
        curId++;
        lastId++;
        totalId++;
    }

    noteState();
}
////////////////////////////////////////////////////////////////////////////////
//
// check gadget docked state
//
////////////////////////////////////////////////////////////////////////////////
function checkState()
{
    if (System.Gadget.docked) 
    { 
        dockedState();
    } 
    else
    {
        undockedState();
    }
}

////////////////////////////////////////////////////////////////////////////////
//
// check gadget docked state
//
////////////////////////////////////////////////////////////////////////////////
function checkStateReload()
{
    checkState();
    window.setTimeout("reloadAfterDelay();", 500);
    
}

////////////////////////////////////////////////////////////////////////////////
//
// reload the current ink
//
////////////////////////////////////////////////////////////////////////////////
function reloadAfterDelay()
{
    loadInk(gadgetArray[curId].oNoteISFString);
}

////////////////////////////////////////////////////////////////////////////////
//
//  set gadget state to UNDOCKED
//
////////////////////////////////////////////////////////////////////////////////
function undockedState()
{
    bgImgDockState = "";

    with (document.body.style)
    {
        width = "197px";
        height = "177px";
    }
    notesBg.style.width = "197px";
    notesBg.style.height = "177px";
    notesBg.src = "url(images/sticky_" + curColor + bgImgDockState + ".png)";

    with (noteArea.style)
    {
        width = "168px";
        height = "130px";
        top = "10px";
        left = "9px";
    }

    with (leftArrow.style)
    {
        top = "140px";
        left = "63px";
    }

    with (pageWell.style)
    {
        width = "197px";
        height = "20px";
        top = "138px"; 
    }
    
    with (rightArrow.style)
    {
        top = "140px";
        left = "117px";
    }

    with (plusIcon.style)
    {
        top = "140px"; 
        left = "164px";
    }
    
    with (deleteIcon.style)
    {
        top = "141px";
        left = "10px";
    }

    updateIconPositioning();
    
    //set the object transform
    var inkTransform = new ActiveXObject("msinkaut.InkTransform");
    inkTransform.ScaleTransform(1.5555, 1.66666);
    noteArea.Renderer.SetObjectTransform(inkTransform);
}
////////////////////////////////////////////////////////////////////////////////
//
// set gadget state to DOCKED
//
////////////////////////////////////////////////////////////////////////////////
function dockedState()
{
    bgImgDockState = "_docked";

    with (document.body.style)
    {
        width = "130px";
        height = "121px";
    }
    notesBg.style.width = "130px";
    notesBg.style.height = "121px";
    notesBg.src = "url(images/sticky_" + curColor + bgImgDockState + ".png)";
    
    with (noteArea.style)
    {
        top = "10px";
        left = "9px";
        width = "108px";
        height = "78px";
    }
    
    with (leftArrow.style)
    {
        top = "88px";
        left = "28px";
    }
    
    with (pageWell.style)
    {
        top = "86px";
        height = "20px";
        width = "129px";
    }
    
    with (rightArrow.style)
    {
        top = "88px";
        left = "84px";
    }
    
    with (plusIcon.style)
    {
        top = "88px";
        left = "104px";
    }
    
    with (deleteIcon.style)
    {
        top = "89px";
        left = "8px";
    }
    
    updateIconPositioning();
   
    //set the object transform
    var inkTransform = new ActiveXObject("msinkaut.InkTransform");
    noteArea.Renderer.SetObjectTransform(inkTransform);
}
////////////////////////////////////////////////////////////////////////////////
//
// reload main after settings page closed
//
////////////////////////////////////////////////////////////////////////////////
function settingsClosed(event)
{
    if (event.closeAction == event.Action.commit)
    {
        loadMain();
    }
}
////////////////////////////////////////////////////////////////////////////////
//
//
////////////////////////////////////////////////////////////////////////////////
function writeSettings(color, sizeDocked, sizeUndocked)
{
    System.Gadget.Settings.write("SettingsExist", true);
    
    if (color)
    {
        System.Gadget.Settings.writeString("ColorSaved", color);
    }

    if (sizeDocked)
    {
        System.Gadget.Settings.write("SizeDockedSaved", sizeDocked);
    }
    
    if (sizeUndocked)
    {
        System.Gadget.Settings.write("SizeUndockedSaved", sizeUndocked);
    }
}
////////////////////////////////////////////////////////////////////////////////
//
// set new settings
//
////////////////////////////////////////////////////////////////////////////////
function setSettings(noteId)
{
    System.Gadget.Settings.writeString(noteId, gadgetArray[noteId].oNoteISFString);
    System.Gadget.Settings.write("NoteCount", gadgetArray.length);
}
////////////////////////////////////////////////////////////////////////////////
//
//
////////////////////////////////////////////////////////////////////////////////
function getSettings(noteId)
{   
    return System.Gadget.Settings.readString(noteId);
}
////////////////////////////////////////////////////////////////////////////////
//
// set new images based on color
//
////////////////////////////////////////////////////////////////////////////////
function setImages(setColor)
{
    curColor = setColor;
    
    notesBg.src = "url(images/sticky_" + setColor + bgImgDockState + ".png)";

    deleteIcon.src = "images/sticky_delete_disabled.png";
    leftArrow.src = "images/sticky_left_disabled.png";
    rightArrow.src = "images/sticky_right_disabled.png";
    plusIcon.src = "images/sticky_plus_disabled.png";
    
    for (var i = 0; i < colorArray.length; i++)
    {
        if(colorArray[i] == curColor)
        {
            noteArea.backcolor = colorHexArray[i];
        }
    }
}
////////////////////////////////////////////////////////////////////////////////
//
// update images based on state
//
////////////////////////////////////////////////////////////////////////////////
function updateImage(objImage, action, state)
{
    if (objImage.src.indexOf("disabled") == -1)
    {
        objImage.src = "images/sticky_" + action + "_" + state + ".png";
    }
}
////////////////////////////////////////////////////////////////////////////////
//
// add a new note
//
////////////////////////////////////////////////////////////////////////////////
function addNote()
{   
    if (gadgetArray.length < maxNumberNotes)
    {
        if (gadgetArray.length > 0)
        {
            saveInk();
        }

        if (initFlag)
        {
            lastId++;
            totalId++
        }
        
        gadgetArray.push(new setNote());
        
        //replace the ink object to clear the InkPicture
        noteArea.InkEnabled = false;
        var newInk = new ActiveXObject("msinkaut.InkObject");
        noteArea.Ink = newInk;
        noteArea.InkEnabled = true;
        
        var displayCount;
        
        if (curId == 0)
        {
            displayCount = 1;
        }
        else
        {
            displayCount = curId + 1;
        }

        curId = gadgetArray.length - 1;

        pageText.innerHTML = gadgetArray.length + " / " + gadgetArray.length;
        
        initFlag = true;

        checkImageState();
        setSettings(curId);

        System.Gadget.Settings.write("SettingsExist", true);
        System.Gadget.Settings.write("NoteState", curId);

        if (gadgetArray.length == maxNumberNotes)
        {
            setAddIcon("disabled");
        }
    }
}

////////////////////////////////////////////////////////////////////////////////
//
// assumes inkISF is a base64 encoded ISF string.  Loads that ISF and adds it to 
// the inkPicture
//
////////////////////////////////////////////////////////////////////////////////
function loadInk(inkISF)
{
    noteArea.InkEnabled = false;
    var newInk = new ActiveXObject("msinkaut.InkObject");
    
    newInk.Load(inkISF);
    noteArea.Ink = newInk;
    noteArea.InkEnabled = true;
}

////////////////////////////////////////////////////////////////////////////////
//
// enable/disable note controls
//
////////////////////////////////////////////////////////////////////////////////
function enableControls(bVisible)
{
    if (!bVisible && (bodyFocus || textAreaFocus || areaFocus))
    {
        return;
    }
    
    with (deleteIcon.style)
    {
        if (bVisible)
        {
            visibility = "visible";
        }
        else
        {
            visibility = "hidden";
        }
    }
    
    with (leftArrow.style)
    {
        if (bVisible && gadgetArray.length > 1)
        {
            visibility = "visible";
        }
        else
        {
            visibility = "hidden";
        }
    }
    
    with (rightArrow.style)
    {
        if (bVisible && gadgetArray.length > 1)
        {
            visibility = "visible";
        }
        else
        {
            visibility = "hidden";
        }
    }
    
    with (plusIcon.style)
    {
        if (bVisible)
        {
            visibility = "visible";
        }
        else
        {
            visibility = "hidden";
        }
    }
    
    with (pageWell.style)
    {
        if (bVisible)
        {
            visibility = "visible";
        }
        else
        {
            visibility = "hidden";
        }
    }    
}
////////////////////////////////////////////////////////////////////////////////
//
// delete current note
//
////////////////////////////////////////////////////////////////////////////////
function deleteNote()
{
    System.Gadget.Settings.writeString(gadgetArray.length - 1, "");
    gadgetArray.splice(curId, 1);
    
    for (var i = 0; i < gadgetArray.length; i++)
    {
        System.Gadget.Settings.writeString(i, gadgetArray[i].oNoteISFString);
    }
    
    if (curId == 0)
    {
        System.Gadget.Settings.write("NoteState", curId);
    }
    else
    {
        System.Gadget.Settings.write("NoteState", curId - 1);
    }
    
    System.Gadget.Settings.write("NoteCount", gadgetArray.length);
    
    setAddIcon("rest");
    setImages(curColor);
    checkImageState();
    loadSaved();
}
////////////////////////////////////////////////////////////////////////////////
//
// update left arrow image
//
////////////////////////////////////////////////////////////////////////////////
function setLeftArrow(stateNow)
{
    leftArrow.src = "images/sticky_left_" + stateNow + ".png";
}
////////////////////////////////////////////////////////////////////////////////
//
// update right arrow image
//
////////////////////////////////////////////////////////////////////////////////
function setRightArrow(stateNow)
{
    rightArrow.src = "images/sticky_right_" + stateNow + ".png";
}
////////////////////////////////////////////////////////////////////////////////
//
// update add image
//
////////////////////////////////////////////////////////////////////////////////
function setAddIcon(stateNow)
{
    plusIcon.src = "images/sticky_plus_" + stateNow + ".png";
}
////////////////////////////////////////////////////////////////////////////////
//
// update delete image
//
////////////////////////////////////////////////////////////////////////////////
function setDeleteIcon(stateNow)
{
    deleteIcon.src = "images/sticky_delete_" + stateNow + ".png";
}
////////////////////////////////////////////////////////////////////////////////
//
// create new note
//
////////////////////////////////////////////////////////////////////////////////
function setNote()
{
    this.oId = "";
    this.oNoteISFString = "";
}

////////////////////////////////////////////////////////////////////////////////
//
// save current note ink
//
////////////////////////////////////////////////////////////////////////////////
function saveInk()
{
    var noteISF = noteArea.Ink.Save(1, 0); //Base64ISF, Default compression
    gadgetArray[curId].oNoteISFString = noteISF;
    setSettings(curId);
    
    if (gadgetArray.length == 1 && noteArea.Ink.Strokes.Count == 0)
    {
        setDeleteIcon("disabled");
    }
    else
    {
        setDeleteIcon("rest");
    }
}

////////////////////////////////////////////////////////////////////////////////
//
// get corrected note count
//
////////////////////////////////////////////////////////////////////////////////
function getNoteCount()
{
    var noteCount = 0;
    
    if (parseInt(System.Gadget.Settings.read("NoteCount")) > -1)
    {
        noteCount = parseInt(System.Gadget.Settings.readString("NoteCount"));
    }
    else
    {
        while (getSettings(noteCount) != "" && noteCount < maxNumberNotes)
        {
            noteCount++;
        }
        
        noteCount++;
    }
    
    if (noteCount > maxNumberNotes)
    {
        noteCount = maxNumberNotes;
    }
    
    System.Gadget.Settings.write("NoteCount", noteCount);
    
    return noteCount;
}

////////////////////////////////////////////////////////////////////////////////
//
//
////////////////////////////////////////////////////////////////////////////////
function setAreaFocus(bFocus, bBodyFocus, bTextAreaFocus)
{
    if (bFocus != null)
    {
        areaFocus = bFocus;
    }

    if (bBodyFocus != null)
    {
        bodyFocus = bBodyFocus;
    }

    if (bTextAreaFocus != null)
    {
        textAreaFocus = bTextAreaFocus;
    }
}
////////////////////////////////////////////////////////////////////////////////
//
//
////////////////////////////////////////////////////////////////////////////////
function checkImageState()
{
    if (curId > 0)
    {
        setLeftArrow("rest");
    }
    else
    {
        setLeftArrow("disabled");
    }
    
    if (gadgetArray.length > (curId + 1))
    {
        setRightArrow("rest");
    }
    else
    {
        setRightArrow("disabled");
    }
    
    if (gadgetArray.length < maxNumberNotes)
    {
        setAddIcon("rest");
    }
    else
    {
        setAddIcon("disabled");
    }
    
    if (gadgetArray.length > 1)
    {
        setDeleteIcon("rest");
        
        pageWell.style.visibility = "visible";
        leftArrow.style.visibility = "visible";
        rightArrow.style.visibility = "visible";
    }
    else
    {
        if (noteArea.Ink.Strokes.Count > 0)
        {
            setDeleteIcon("rest");
        }
        else
        {
            setDeleteIcon("disabled");
        }
        
        pageWell.style.visibility = "hidden";
        leftArrow.style.visibility = "hidden";
        rightArrow.style.visibility = "hidden";
    }
    
    noteArea.focus();
}
////////////////////////////////////////////////////////////////////////////////
//
// set note state
//
////////////////////////////////////////////////////////////////////////////////
function noteState()
{
    curId = System.Gadget.Settings.read("NoteState");
    
    if (curId > (curCount - 1))
    {
        curId = curCount - 1;
    }
    
    loadInk(gadgetArray[curId].oNoteISFString);
    
    var displayCount = curId + 1;
    
    pageText.innerHTML = displayCount + " / " + gadgetArray.length;
    
    System.Gadget.Settings.write("NoteState", curId);
    
    checkImageState();
}
////////////////////////////////////////////////////////////////////////////////
//
// show next note
//
////////////////////////////////////////////////////////////////////////////////
function nextNote()
{
    saveInk();
    
    if (gadgetArray[curId + 1])
    {
        curId++;
        pageText.innerHTML = (curId + 1) + " / " + gadgetArray.length;
        loadInk(gadgetArray[curId].oNoteISFString);
        
        System.Gadget.Settings.write("NoteState", curId);
    }

    checkImageState();
}
////////////////////////////////////////////////////////////////////////////////
//
// show previous note
//
////////////////////////////////////////////////////////////////////////////////
function previousNote()
{
    saveInk();
    
    if (gadgetArray[curId - 1])
    {
        curId--;
        pageText.innerHTML = (curId+1) + " / " + gadgetArray.length;
        loadInk(gadgetArray[curId].oNoteISFString);
        
        System.Gadget.Settings.write("NoteState", curId);
    }
    
    checkImageState();
}
////////////////////////////////////////////////////////////////////////////////
//
// scroll text area with mouse wheel
//
////////////////////////////////////////////////////////////////////////////////
function scrollTextArea(oArea)
{
    if (event.wheelDelta > 0)
    {
        oArea.doScroll("scrollbarUp");
    }
    else
    {
        oArea.doScroll("scrollbarDown");
    }
}
////////////////////////////////////////////////////////////////////////////////
//
// reverse icons for RTL
//
////////////////////////////////////////////////////////////////////////////////
function updateIconPositioning()
{
    if (pageDir == "rtl")
    {
        var tempPoint = parseInt(plusIcon.style.left);

        with (plusIcon.style)
        {
            left = deleteIcon.style.left;
            top = (parseInt(top) + 1) + "px";
        }
        
        with (deleteIcon.style)
        {
            left = (tempPoint + 1) + "px";
            top = (parseInt(top) - 1) + "px";
        }
    }
}
////////////////////////////////////////////////////////////////////////////////
//
//
////////////////////////////////////////////////////////////////////////////////
function getValidSetting(setting, objArray, index)
{
    if (setting != null)
    {
        for (var i = 0; i < objArray.length; i++)
        {
            if (setting == objArray[i])
            {
                index = i;
                break;
            }
        }
    }
    
    return objArray[index];
}
