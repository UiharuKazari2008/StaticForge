Function initGadget()
    System.Gadget.Flyout.file = "detail.htm"
    System.Gadget.Flyout.onShow = GetRef("UpdateFlyout")
    
    GenerateLayout
End Function

Function GenerateLayout()
    If Not Docked Then
        GenerateUndockedLayout
    Else
        GenerateDockedLayout
    End If
End Function

Function GenerateUndockedLayout()
    'Call generateDockedLayout for now...
    GenerateDockedLayout
End Function

Function GenerateDockedLayout()
    With document.body.style
        .height = "100px"
        .width = "130px"
    End With
    
    With divMainFrame.style
        .height = "84px"
        .width = "114px"
        .padding = "4px"
    End With
    
    System.Gadget.background = "url(images/bofh.png)"
End Function

Function OpenFlyout()
    If System.Gadget.Flyout.show Then
        System.Gadget.Flyout.show = False
    Else
        System.Gadget.Flyout.show = True
    End If           
End Function

Function UpdateFlyout()
    Set flyoutDoc = System.Gadget.Flyout.document
    
    flyoutDoc.getElementById("divDetail").innerHTML = GetExcuse()
End Function

Function GetExcuse()
    intRnd = 1000
    
    While intRnd >= UBound(arrExcuses)
        Randomize
        intRnd = Round(Rnd() * 1000)
    Wend
    
    GetExcuse = arrExcuses(intRnd)
End Function