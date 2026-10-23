////////////////////////////////////////////////////////////////////////////////
//
//  THIS CODE IS NOT APPROVED FOR USE IN/ON ANY OTHER UI ELEMENT OR PRODUCT COMPONENT.
//  Copyright (c) 2008 Lorne L. Reap  All rights reserved.
//
////////////////////////////////////////////////////////////////////////////////
var e = new Array();
var eItem = 0;
var eZone = 1;
var eOffset = 2;

var zones = null;
var zonesCount = 0;

function updateTimeZones(sortName)
{
    zones = System.Time.timeZones;
    zonesCount = zones.count;
    
    if (sortName)
    {
        var zoneArray = new Array();
        
        for (var i = 0; i < zonesCount; i++)
        {
            zoneArray[i] = [i, zones.item(i).displayName, zones.item(i).bias];
        }

        var zoneArrayTemp1 = [];
        zoneArrayTemp1.push(zoneArray[0]);
        
        for (var i = 1; i < zoneArray.length; i++)
        {
            for (var j = 0; j < zoneArrayTemp1.length; j++)
            {
                if (zoneArray[i][eOffset] >= zoneArrayTemp1[j][eOffset])
                {
                    for (var k = zoneArrayTemp1.length - 1; k >= j; k--)
                    {
                        zoneArrayTemp1[k + 1] = zoneArrayTemp1[k];
                    }
                    
                    zoneArrayTemp1[j] = zoneArray[i];
                    
                    if (zoneArrayTemp1[j + 1][eOffset] == zoneArrayTemp1[j][eOffset])
                    {
                        var tempArray1 = [];
                        var tempArray2 = [];
                        
                        for (var l = j; l < zoneArrayTemp1.length; l++)
                        {
                            if (zoneArrayTemp1[j][eOffset] != zoneArrayTemp1[l][eOffset])
                            {
                                break;
                            }
                            
                            tempArray1[zoneArrayTemp1[l][eZone]] = zoneArrayTemp1[l][eItem];
                            tempArray2[tempArray2.length] = zoneArrayTemp1[l][eZone];
                        }
                        
                        if (tempArray2.length > 1)
                        {
                            tempArray2.sort();
                            
                            for (var l = 0; l < tempArray2.length; l++)
                            {
                                zoneArrayTemp1[j + l][0] = tempArray1[tempArray2[l]];
                                zoneArrayTemp1[j + l][1] = tempArray2[l];
                            }
                        }
                    }
                    
                    break;
                }
            }
        }
        
        zoneArrayTemp1.length--;
        
        var zoneArrayTemp2 = [];
        zoneArrayTemp2.push(zoneArray[0]);
        
        for (var i = 1; i < zoneArray.length; i++)
        {
            for (var j = 0; j < zoneArrayTemp2.length; j++)
            {
                if (zoneArray[i][eOffset] <= zoneArrayTemp2[j][eOffset])
                {
                    for (var k = zoneArrayTemp2.length - 1; k >= j; k--)
                    {
                        zoneArrayTemp2[k + 1] = zoneArrayTemp2[k];
                    }
                    
                    zoneArrayTemp2[j] = zoneArray[i];
                    
                    if (zoneArrayTemp2[j + 1][eOffset] == zoneArrayTemp2[j][eOffset])
                    {
                        var tempArray1 = [];
                        var tempArray2 = [];
                    
                        for (var l = j; l < zoneArrayTemp2.length; l++)
                        {
                            if (zoneArrayTemp2[j][eOffset] != zoneArrayTemp2[l][eOffset])
                            {
                                break;
                            }
                            
                            tempArray1[zoneArrayTemp2[l][eZone]] = zoneArrayTemp2[l][eItem];
                            tempArray2[tempArray2.length] = zoneArrayTemp2[l][eZone];
                        }
                        
                        if (tempArray2.length > 1)
                        {
                            tempArray2.sort(compareDisplayName);
                            
                            for (var l = 0; l < tempArray2.length; l++)
                            {
                                zoneArrayTemp2[j + l][0] = tempArray1[tempArray2[l]];
                                zoneArrayTemp2[j + l][1] = tempArray2[l];
                            }
                        }
                    }
                    
                    break;
                }
            }
        }
        
        zoneArrayTemp2.reverse();
        
        e = zoneArrayTemp1.concat(zoneArrayTemp2);
    }
}
function compareDisplayName(string1, string2)
{
    for (var i = 0; i < Math.min(string1.length, string2.length); i++)
    {
        if (string1.charAt(i) != string2.charAt(i))
        {
            return (string1.charAt(i) < string2.charAt(i) ? 1 : -1);
        }
    }

    return 0;
}
function getCurrentTimeZone()
{
    if (zonesCount > 0)
    {
        var curZone = System.Time.currentTimeZone;

        for (var i = 0; i < zonesCount; i++)
        {
            if (zones.item(i).standardDisplayName == curZone.standardDisplayName)
            {
                return i;
            }
        }
    }
    
    return -1;
}
function getValidTimeZone(index)
{
    if (parseInt(index) > -1 && parseInt(index) < zonesCount)
    {
        return parseInt(index);
    }
    else
    {
        return -1;
    }
}
