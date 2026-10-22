////////////////////////////////////////////////////////////////////////////////
//
//  THIS CODE IS NOT APPROVED FOR USE IN/ON ANY OTHER UI ELEMENT OR PRODUCT COMPONENT.
//  Copyright (c) 2006 Microsoft Corporation.  All rights reserved.
//
////////////////////////////////////////////////////////////////////////////////

__System.Controls.UI.Components.AutoCompleteMode =
{
    Append: 1 << 0,
    None: 1 << 1,
    Suggest: 1 << 2,
    SuggestAppend: 1 << 3
}

if (typeof AutoCompleteMode == "undefined")
{
    AutoCompleteMode = __System.Controls.UI.Components.AutoCompleteMode;
}

__System.Controls.UI.Components.AutoCompleteSource =
{
    AllSystemSources: 1 << 0,
    AllUrl: 1 << 1,
    CustomSource: 1 << 2,
    FileSystem: 1 << 3,
    FileSystemDirectories: 1 << 4,
    HistoryList: 1 << 5,
    ListItems: 1 << 6,
    None: 1 << 7,
    RecentlyUsedList: 1 << 8
}

if (typeof AutoCompleteSource == "undefined")
{
    AutoCompleteSource = __System.Controls.UI.Components.AutoCompleteSource;
}

__System.Controls.UI.Components.CharacterCasing =
{
    Lower: 1 << 0,
    Normal: 1 << 1,
    Upper: 1 << 2
}

if (typeof CharacterCasing == "undefined")
{
   CharacterCasing = __System.Controls.UI.Components.CharacterCasing;
}

__System.Controls.UI.Components.ComboBoxStyle =
{
    DropDown: 1 << 0,
    DropDownList: 1 << 1,
    Simple: 1 << 2
}

if (typeof ComboBoxStyle == "undefined")
{
    ComboBoxStyle = __System.Controls.UI.Components.ComboBoxStyle;
}

__System.Controls.UI.Components.DockStyle =
{
    Bottom: 1 << 0,
    Fill: 1 << 1,
    Left: 1 << 2,
    None: 1 << 3,
    Right: 1 << 4,
    Top: 1 << 5
}

if (typeof DockStyle == "undefined")
{
    DockStyle = __System.Controls.UI.Components.DockStyle;
}

__System.Controls.UI.Components.FontStyle =
{
    Bold: 1 << 0,
    Italic: 1 << 1,
    Regular: 1 << 2,
    Strikeout: 1 << 3,
    Underline: 1 << 4
}

if (typeof FontStyle == "undefined")
{
    FontStyle = __System.Controls.UI.Components.FontStyle;
}

__System.Controls.UI.Components.HorizontalAlignment =
{
    Center: "center",
    Left: "left",
    Right: "right"
}

if (typeof HorizontalAlignment == "undefined")
{
    HorizontalAlignment = __System.Controls.UI.Components.HorizontalAlignment;
}

__System.Controls.UI.Components.SelectionMode =
{
    MultiExtended: 1 << 0,
    MultiSimple: 1 << 1,
    None: 1 << 2,
    One: 1 << 3
}

if (typeof SelectionMode == "undefined")
{
    SelectionMode = __System.Controls.UI.Components.SelectionMode;
}

__System.Controls.UI.Components.ToolStripItemDisplayStyle =
{
    Image: 1 << 0,
    ImageAndText: 1 << 1,
    None: 1 << 2,
    Text: 1 << 3
}

if (typeof ToolStripItemDisplayStyle == "undefined")
{
    ToolStripItemDisplayStyle = __System.Controls.UI.Components.ToolStripItemDisplayStyle;
}

__System.Import("System.Controls.UI.Components.Enumerations", true);
