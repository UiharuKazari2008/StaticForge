////////////////////////////////////////////////////////////////////////////////
//
//  THIS CODE IS NOT APPROVED FOR USE IN/ON ANY OTHER UI ELEMENT OR PRODUCT COMPONENT.
//  Copyright (c) 2006 Microsoft Corporation.  All rights reserved.
//
////////////////////////////////////////////////////////////////////////////////
var L_PREVIOUS_text = "Previous";
var L_NEXT_text = "Next";

var imagePath   = "images/";
var imageArray  = new Array("sticky_yellow_docked.png", "sticky_purple_docked.png", "sticky_blue_docked.png", "sticky_green_docked.png", "sticky_pink_docked.png", "sticky_white_docked.png");
var imageIndex  = 0;
////////////////////////////////////////////////////////////////////////////////
//
// setup gadget settings
//
////////////////////////////////////////////////////////////////////////////////
function loadSettings()
{
    var pageDir = document.getElementsByTagName("html")[0].dir;
    
    if (pageDir == "rtl")
    {
        settingsButtonTable.dir = "rtl";
        
        var temp = settingsButtonLeftCell.innerHTML;
        settingsButtonLeftCell.innerHTML = settingsButtonRightCell.innerHTML;
        settingsButtonRightCell.innerHTML = temp;
        
        temp = settingsImageLeft.onclick;
        settingsImageLeft.onclick = settingsImageRight.onclick;
        settingsImageRight.onclick = temp;

        settingsImageLeft.alt = L_NEXT_text;
        settingsImageRight.alt = L_PREVIOUS_text;
    }
    else
    {
        settingsImageLeft.alt = L_PREVIOUS_text;
        settingsImageRight.alt = L_NEXT_text;
    }
    
    if (System.Gadget.Settings.read("SettingsExist"))
    {
        for (var i = 0; i < colorArray.length; i++)
        {
            if (colorArray[i] == System.Gadget.Settings.readString("ColorSaved"))
            {
                imageIndex = i;
            }
        }
    }

    settingsUpdateIndex();
    
    System.Gadget.onSettingsClosing = settingsClosing;
}
////////////////////////////////////////////////////////////////////////////////
//
//
////////////////////////////////////////////////////////////////////////////////
function settingsUpdateImage(img, state)
{
    img.src = imagePath + "settings_" + img.src.split("_")[1] + "_" + state + ".png";
}
////////////////////////////////////////////////////////////////////////////////
//
//
////////////////////////////////////////////////////////////////////////////////
function settingsButtonBack(override)
{
    if (event.keyCode == 32 || override)
    {
        imageIndex--;
        
        if (imageIndex < 0)
        {
            imageIndex = imageArray.length - 1;
        }
        
        settingsUpdateIndex();
    }
}
////////////////////////////////////////////////////////////////////////////////
//
//
////////////////////////////////////////////////////////////////////////////////
function settingsButtonForward(override)
{
    if (event.keyCode == 32 || override)
    {
        imageIndex++;
        
        if (imageIndex == imageArray.length)
        {
            imageIndex = 0;
        }
        
        settingsUpdateIndex();
    }
}
////////////////////////////////////////////////////////////////////////////////
//
//
////////////////////////////////////////////////////////////////////////////////
function settingsUpdateIndex()
{
    settingsImagePreview.src = imagePath + imageArray[imageIndex];
    currentIndex.innerHTML = imageIndex + 1;
    maxIndex.innerHTML = imageArray.length;
}
////////////////////////////////////////////////////////////////////////////////
//
// event for settings page closing
//
////////////////////////////////////////////////////////////////////////////////
function settingsClosing(event)
{
    if (event.closeAction == event.Action.commit)
    {
        System.Gadget.Settings.write("SettingsExist", true);
        System.Gadget.Settings.writeString("ColorSaved", colorArray[imageIndex]);
    }
}
