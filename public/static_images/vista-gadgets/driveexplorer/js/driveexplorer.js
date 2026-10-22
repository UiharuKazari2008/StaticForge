var driveExplorerComboBox;
var driveExplorerTreeView;
var driveAvailableMap;
var flyoutNode;
var flyoutBodyEntered = false;
var selectedItemIndex = -1;
var itemList = null;
var itemCount = 0;

function loadPage()
{
    if (!__System.IsFrameworkLoaded())
    {
        setTimeout("loadPage()");
    }
    else
    {
        loadGadget();
    }
}

function loadFolders()
{
    var style = System.Gadget.Settings.read("driveExplorerStyle");
    
    if (style)
    {
        document.body.style.background = "url(../images/normal_" + style + ".png) no-repeat";
    }
    
    driveAvailableMap = [];
    driveExplorerTreeView.Nodes.Clear();
    
    var drives = System.Gadget.Settings.read("driveExplorerFolders");
    
    if (drives)
    {
        drives = drives.split("|");
        
        for (var i = 0; i < drives.length; i++)
        {
            if (drives[i] && drives[i].toUpperCase().charAt(0) != "A")
            {
                openFolder(drives[i]);
            }
        }
    }
    else
    {
        openFolder("C:\\");
    }
    
    driveExplorerTreeView.Load();
    
    setComboBoxPath(driveExplorerTreeView.Nodes[0].Tag);
}

function loadSettings()
{
    var drives = System.Gadget.Settings.read("driveExplorerFolders");
    
    if (drives)
    {
        drives = drives.split("|");
    }
    else
    {
        drives = ["C:\\"];
    }
    
    for (var i = 0; i < drives.length; i++)
    {
        driveExplorerDrives.options[driveExplorerDrives.options.length] = new Option(drives[i], drives[i]);
    }
    
    var style = System.Gadget.Settings.read("driveExplorerStyle");
    
    if (style)
    {
        for (var i = 0; i < driveExplorerStyle.length; i++)
        {
            if (driveExplorerStyle[i].value == style.toLowerCase())
            {
                driveExplorerStyle[i].checked = true;
                break;
            }
        }
    }
}

function settingsClosing()
{
    var drives = "";
    
    for (var i = 0; i < driveExplorerDrives.options.length; i++)
    {
        drives += (i > 0 ? "|" : "") + driveExplorerDrives.options[i].value;
    }
    
    System.Gadget.Settings.write("driveExplorerFolders", drives);
        
    for (var i = 0; i < driveExplorerStyle.length; i++)
    {
        if (driveExplorerStyle[i].checked)
        {
            System.Gadget.Settings.write("driveExplorerStyle", driveExplorerStyle[i].value);
            break;
        }
    }
}

function openShellFolder()
{
    var folder = System.Shell.chooseFolder("Select a drive to explore", 512);
    
    if (folder && folder.path.length > 0)
    {   
        if (folder.path.charAt(0).toUpperCase() == "A")
        {
            return;
        }
        
        for (var i = 0; i < driveExplorerDrives.options.length; i++)
        {
            if (driveExplorerDrives.options[i].value.toLowerCase() == folder.path.toLowerCase())
            {
                return;
            }
        }
        
        driveExplorerDrives.options[driveExplorerDrives.options.length] = new Option(folder.path, folder.path);
        driveExplorerDrives.selectedIndex = driveExplorerDrives.options.length - 1;
    }
}

function removeFolder()
{
    if (driveExplorerDrives.options.length > 1)
    {
        driveExplorerDrives.options[driveExplorerDrives.selectedIndex] = null;
    }
}

function openFlyout(drivePath)
{
    System.Gadget.Settings.write("fileExplorerPath", drivePath);
    System.Gadget.Flyout.show = true;
}

function navigateFolderContents(evt)
{
    var index = -1;

    switch (evt.keyCode)
    {
        case 13:
            if (itemList != null && selectedItemIndex != -1)
            {
                openFile(itemList[selectedItemIndex].path);
            }
            break;
        case 38:
            index = Math.max(0, selectedItemIndex - 1);
            break;
        case 40:
            index = Math.min(itemCount - 1, selectedItemIndex + 1);
            break;
    }
    
    if (index != -1)
    {
        selectItem(index);
        driveExplorerScrollBar._EnsureVisible("driveExplorerItems$" + index +"$0", null, false, true);
    }
}

function buildFolderContents(path)
{
    var folder = System.Shell.itemFromPath(path);
    var items = sortFolderItems(folder.SHFolder.Items);
    
    var output = '<table id="driveExplorerItems" cellspacing="0" cellpadding="0" border="0" style="font-family:Segoe UI;font-size:11px">';
    
    for (var i = 0; i < items.length; i++)
    {
        output += '<tr style="height:19px" onmouseenter="selectItem(' + i + ', true)" onmouseleave="selectItem(' + i + ', false)" onmousedown="selectItem(' + i + ')" ondblclick="openFile(\'' + items[i].path.replace(/\\/g, "\\\\").replace(/\'/g, "\\'") + '\', ' + (items[i].isFolder ? 1 : 0) +')">'+
                  '<td id="driveExplorerItems$' + i +'$0" style="width:3px" nowrap></td>'+
                  '<td id="driveExplorerItems$' + i +'$1" style="width:16px;padding:0px 5px 0px 5px" nowrap>' + (items[i].isFolder ? '<img src="images/Folder.png" />' : '') +'</td>'+
                  '<td id="driveExplorerItems$' + i +'$2" style="width:1px;font-size:0px;background-color:#eeeeee">&nbsp;</td>'+
                  '<td id="driveExplorerItems$' + i +'$3" style="padding:0px 5px 0px 5px" nowrap>' + items[i].name +'</td>'+
                  '<td id="driveExplorerItems$' + i +'$4" style="width:1px;font-size:0px;background-color:#eeeeee">&nbsp;</td>'+
                  '<td id="driveExplorerItems$' + i +'$5" style="padding:0px 5px 0px 5px" nowrap>' + items[i].modifyDate +'</td>'+
                  '<td id="driveExplorerItems$' + i +'$6" style="width:1px;font-size:0px;background-color:#eeeeee">&nbsp;</td>'+
                  '<td id="driveExplorerItems$' + i +'$7" style="padding:0px 5px 0px 5px" nowrap>' + items[i].type +'</td>'+
                  '<td id="driveExplorerItems$' + i +'$8" style="width:1px;font-size:0px;background-color:#eeeeee">&nbsp;</td>'+
                  '<td id="driveExplorerItems$' + i +'$9" style="padding:0px 5px 0px 5px" nowrap>' + (items[i].size ? items[i].size : "") +'</td>'+
                  '<td id="driveExplorerItems$' + i +'$10" style="width:3px" nowrap></td>'+
                  '</tr>';
    }
    
    output += '</table>';
    
    driveExplorerContents.innerHTML = output;
    
    itemList = items;
    itemCount = items.length;
}

function selectItem(index, selected, focus)
{
    if (index == -1)
    {
        return;
    }
    
    if (selected == null && selectedItemIndex != index)
    {
        if (selectedItemIndex != -1)
        {
            var prevIndex = selectedItemIndex;
            selectedItemIndex = -1;
            selectItem(prevIndex, false);
        }
        
        selectedItemIndex = index;
    }
    
    var imageName = "Selected";
    
    if (selectedItemIndex != index)
    {
        if (selected != null && !selected)
        {
            imageName = "";
        }
        else if (selected)
        {
            imageName = "Unselected";
        }
    }
    
    if (!flyoutBodyEntered && focus)
    {
        imageName = "NonFocus";
    }
    
    if (imageName != "")
    {
        imageName = __System.BasePath + "/resources/ui/treeview/" + imageName;
    }
    
    document.getElementById("driveExplorerItems$" + index + "$0").style.backgroundImage = "url(" + (imageName != "" ? imageName + "ItemLeft" + (selected == null || selected ? "Hover" : "") + ".png" : "") + ")";
    document.getElementById("driveExplorerItems$" + index + "$10").style.backgroundImage = "url(" + (imageName != "" ? imageName + "ItemRight" + (selected == null || selected ? "Hover" : "") + ".png" : "") + ")";
    
    for (var i = 1; i <= 9; i++)
    {
        document.getElementById("driveExplorerItems$" + index + "$" + i).style.backgroundImage = "url(" + (imageName != "" ? imageName + "ItemBg" + (selected == null || selected ? "Hover" : "") + ".png" : "") + ")";
    }
}

function flyoutBodyState(enter)
{
    flyoutBodyEntered = enter;
}

function sortFolderItems(items)
{
    var folders = [];
    var files = [];
    
    for (var i = 0; i < items.count; i++)
    {
        if (items.item(i).isFolder)
        {
            folders.push(items.item(i));
        }
        else
        {
            files.push(items.item(i));
        }
    }
    
    var sorted = [];
    
    for (var i = 0; i < folders.length; i++)
    {
        sorted.push(folders[i]);
    }
    
    for (var i = 0; i < files.length; i++)
    {
        sorted.push(files[i]);
    }
    
    return sorted;
}

function openFile(path, isFolder)
{
    if (isFolder)
    {
        buildFolderContents(path);
        driveExplorerScrollBar.Created = false;
        driveExplorerScrollBar.Load();
        
        selectedItemIndex = -1;
    }
    else
    {
        try
        {
            System.Shell.execute(path);
        }
        catch (e)
        {
        }
    }
}

function openFolder(path)
{
    var folder = null;
    
    try
    {
        folder = System.Shell.itemFromPath(path);
    }
    catch (e)
    {
    }
    
    if (folder != null)
    {
        driveExplorerTreeView.Nodes.Add(folder.name);
        driveExplorerTreeView.Nodes[driveExplorerTreeView.GetNodeCount() - 1].TreeView = driveExplorerTreeView;
        driveExplorerTreeView.Nodes[driveExplorerTreeView.GetNodeCount() - 1].HasNodes = hasFolders(path);
        driveExplorerTreeView.Nodes[driveExplorerTreeView.GetNodeCount() - 1].Tag = path;
        
        driveAvailableMap.push(path.toLowerCase());
    }
}

function isPathAvailable(path)
{
    if (path)
    {
        for (var i = 0; i < driveAvailableMap.length; i++)
        {
            if (driveAvailableMap[i] == path.substring(0, driveAvailableMap[i].length).toLowerCase())
            {
                return true;
            }
        }
    }
    
    return false;
}

function hasFolders(path)
{
    var folder = getFolder(path);
    
    if (folder != null)
    {
        var items = folder.SHFolder.Items;
        
        for (var i = 0; i < items.count; i++)
        {
            if (items.item(i).isFolder)
            {
                return true;
            }
        }
    }
    
    return false;
}

function getFolder(path)
{
    try
    {
        return System.Shell.itemFromPath(path);
    }
    catch (e)
    {
        return null;
    }
}

function setComboBoxPath(text)
{
    document.getElementById(driveExplorerComboBox.ControlName.get() + "$TextBox").value = text;
    driveExplorerComboBox.OnKeyPress();
}

function getNodeIndex(nodes, tag)
{
    for (var i = 0; i < nodes.Count; i++)
    {
        if (nodes[i].Tag != null && nodes[i].Tag.toLowerCase() == tag.toLowerCase())
        {
            return i;
        }
    }
    
    return -1;
}

function expandNodes(nodePath)
{
    var driveIndex = -1;
    
    var enumerator = driveExplorerTreeView.Nodes.GetEnumerator();
    
    while (enumerator.MoveNext())
    {
        if (driveExplorerTreeView.Nodes[enumerator.Current].Tag != null && driveExplorerTreeView.Nodes[enumerator.Current].Tag.charAt(0).toUpperCase() == nodePath.charAt(0).toUpperCase())
        {
            driveIndex = enumerator.Current;
        }
    }
    
    var node = null;
    
    if (driveIndex != -1)
    {
        var folders = nodePath.split("\\");

        var nodePath = "driveExplorerTreeView.Nodes[" + driveIndex + "]";
        var folderPath = folders[0];
        
        for (var i = 1; i <= folders.length; i++)
        {
            folderPath += "\\";
            
            try
            {
                node = eval(nodePath);
            }
            catch (e)
            {
                return null;
            }
            
            if (node != null)
            {
                if (node.GetNodeCount() == 0)
                {
                    driveExplorerTreeView.OnBeforeExpand(node);
                }
                
                node.Expand();
                
                if (i < folders.length)
                {
                    folderPath += folders[i];
                    
                    var index = getNodeIndex(node.Nodes, folderPath);
                    
                    if (index != -1)
                    {
                        nodePath += ".Nodes[" + index + "]";
                    }
                    else
                    {
                        return null;
                    }
                }
            }
        }
    }
    
    return node;
}