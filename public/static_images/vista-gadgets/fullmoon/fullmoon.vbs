Function GetLongMonthName(pMonth)
    GetLongMonthName = MonthName(pMonth + 1)
End Function

Function GetShortMonthName(pMonth)
    GetShortMonthName = MonthName(pMonth + 1, 1)
End Function

Function GetShortWeekdayName(pDayOfWeek)
    GetShortWeekdayName = WeekDayName(pDayOfWeek, 1)
End Function
