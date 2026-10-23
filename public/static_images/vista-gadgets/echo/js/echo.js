////////////////////////////////////////////////////////////////////////////////
//
//  THIS CODE IS NOT APPROVED FOR USE IN/ON ANY OTHER COMMERCIAL UI ELEMENT OR PRODUCT COMPONENT.  
//  Copyright (c) 2006 Steve Jensen and John Moscarillo  All rights reserved.
//
////////////////////////////////////////////////////////////////////////////////

//                                            0       1       2        3
var gColorArray                 = new Array("Red", "Green", "Blue", "Yellow");

var gSimonArray                 = new Array();
var gColorIndex;
var gGameState;
var STATE_WAIT             = 0;
var STATE_PLAYING          = 1;
var STATE_USER_TURN        = 2;
var STATE_USER_TURN_WAIT   = 3;

var gPatternIndex;
var gPatternOn;

var gTxtStartGame = "Start Game";
var gTxtLevel     = "Level: ";
var gTxtWrong     = "Incorrect";
var gTxtCorrect   = "Correct";
var gTxtYourTurn  = "Your Turn";

var gPatternStartTime = 1000;
var gBlinkOnTime      = 700;
var gBlinkOffTime     = 200;
var gShowUserTime     = 500;
var gShowCorrectTime  = 2000;
var gShowWrongTime    = 2000;

////////////////////////////////////////////////////////////////////////////////
//
//
//
////////////////////////////////////////////////////////////////////////////////
function loadMain()
{
    System.Gadget.background = "url(images/background_docked.png)";

    showInfo(gTxtStartGame);

    gGameState = STATE_WAIT;
    gPatternOn = false;
    gSimonArray.splice(0,gSimonArray.length);

    addToPattern();
}


////////////////////////////////////////////////////////////////////////////////
//
//
//
////////////////////////////////////////////////////////////////////////////////
function gameControl()
{
    if (gGameState == STATE_WAIT)
    {
        showInfo("");
        showPattern();
    }
}


////////////////////////////////////////////////////////////////////////////////
//
//
//
////////////////////////////////////////////////////////////////////////////////
function showInfo(message)
{
    infoBar.innerHTML = message;
}


////////////////////////////////////////////////////////////////////////////////
//
//
//
////////////////////////////////////////////////////////////////////////////////
function addToPattern()
{
    var newColor = Math.floor(Math.random()*4);
    gSimonArray.push(newColor);
}


////////////////////////////////////////////////////////////////////////////////
//
//
//
////////////////////////////////////////////////////////////////////////////////
function showPattern()
{
    if (gGameState != STATE_PLAYING)
    {
        gGameState = STATE_PLAYING;
        gPatternIndex = 0;    // start showing sequence from the beginning
        gPatternOn = false;

        showInfo(gTxtLevel + gSimonArray.length);

        // wait a bit before starting pattern again
        setTimeout("showPattern()", gPatternStartTime);
        return;
    }

    if (gPatternOn)
    {
        gPatternOn = false;
        returnToRest();
        setTimeout("showPattern()", gBlinkOffTime);
    }
    else
    {
        if(gPatternIndex < gSimonArray.length)
        {
            gPatternOn = true;
            showSquare(gSimonArray[gPatternIndex]);
            setTimeout("showPattern()", gBlinkOnTime);

            gPatternIndex++;
        }
        else
        {
            // finished showing pattern, let user play
            gGameState = STATE_USER_TURN;

            showInfo(gTxtYourTurn);

            gPatternIndex = 0;    // reset to compare with user's clicks
        }
    }
}


////////////////////////////////////////////////////////////////////////////////
//
//
//
////////////////////////////////////////////////////////////////////////////////
function clickedSquare(clickedVal)
{
    if (gGameState == STATE_USER_TURN)
    {
        if (clickedVal.id == gSimonArray[gPatternIndex])
        {
            // click was correct - show it
            showSquare(clickedVal.id);

            gPatternIndex++;   // ready for next click from user

            if(gPatternIndex == gSimonArray.length)
            {
                // user completed pattern successfully - extend and show again
                gGameState = STATE_USER_TURN_WAIT;

                showInfo(gTxtCorrect);

                setTimeout("finishedPattern()", gShowCorrectTime);
            }
            else
            {
                // wait a bit, then turn light off after user click
                gGameState = STATE_USER_TURN_WAIT;
                setTimeout("unclickSquare()", gShowUserTime);
            }
        }
        else
        {
            // Nope, user got it wrong!
            showSquare(clickedVal.id);

            showInfo(gTxtWrong);

            gGameState = STATE_USER_TURN_WAIT;
            setTimeout("wrongSquare()", gShowWrongTime);
        }
    }
}


////////////////////////////////////////////////////////////////////////////////
//
//
//
////////////////////////////////////////////////////////////////////////////////
function unclickSquare()
{
    returnToRest();

    gGameState = STATE_USER_TURN;
}


////////////////////////////////////////////////////////////////////////////////
//
//
//
////////////////////////////////////////////////////////////////////////////////
function wrongSquare()
{
    returnToRest();
    showPattern();
}


////////////////////////////////////////////////////////////////////////////////
//
//
//
////////////////////////////////////////////////////////////////////////////////
function finishedPattern()
{
    returnToRest();

    addToPattern();
    showPattern();
}


////////////////////////////////////////////////////////////////////////////////
//
//
//
////////////////////////////////////////////////////////////////////////////////
function showSquare(squareID)
{
    imageHolder.src= "images/Echo"+gColorArray[squareID]+".png";
}


////////////////////////////////////////////////////////////////////////////////
//
//
//
////////////////////////////////////////////////////////////////////////////////
function returnToRest()
{
    imageHolder.src= "images/EchoBase.png";
}

