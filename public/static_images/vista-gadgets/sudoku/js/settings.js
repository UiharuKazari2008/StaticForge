////////////////////////////////////////////////////////////////////////////////
//
//  THIS CODE IS NOT APPROVED FOR USE IN/ON ANY OTHER UI ELEMENT OR PRODUCT COMPONENT.
//  Copyright (c) 2006 Microsoft Corporation.  All rights reserved.
//
////////////////////////////////////////////////////////////////////////////////
var L_BEGINNER_TEXT      = "Beginner";
var L_INTERMEDIATE_TEXT  = "Intermediate";
var L_ADVANCED_TEXT      = "Advanced";
var L_EXPERT_TEXT        = "Expert";
var L_levelArray    = [L_BEGINNER_TEXT, L_INTERMEDIATE_TEXT, L_ADVANCED_TEXT, L_EXPERT_TEXT];

function loadSettings()
{
    selectGameLevel();
    
    System.Gadget.onSettingsClosing = settingsClosing;
}

function selectGameLevel()
{
    var settingsLevel = System.Gadget.Settings.read("GameLevel");
    
    for (var i = 0; i < L_levelArray.length; i++)
    {
        var selected = false;

        if (settingsLevel == i)
        {
            selected = true;
        }

        sudokuLevel.options[i] = new Option(L_levelArray[i], i, false, selected);
    }
}

function settingsClosing(event)
{
    if (event.closeAction == event.Action.commit)
    {
        System.Gadget.Settings.write("SettingsExist", true);
        System.Gadget.Settings.write("GameLevel", sudokuLevel.value);
    }

    event.cancel = false;
}
