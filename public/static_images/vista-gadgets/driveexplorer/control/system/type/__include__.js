////////////////////////////////////////////////////////////////////////////////
//
//  THIS CODE IS NOT APPROVED FOR USE IN/ON ANY OTHER UI ELEMENT OR PRODUCT COMPONENT.
//  Copyright (c) 2006 Microsoft Corporation.  All rights reserved.
//
////////////////////////////////////////////////////////////////////////////////

__System.Type =
{
    GetTypeCode: function(/*Object*/ obj)
    {
        // summary:
        //   Gets the underlying type code of the specified Type.
        //
        // arguments:
        //   obj (required)
        //
        // returns: TypeCode
        
        if (typeof obj == "boolean" || obj instanceof Boolean)
        {
            return __System.TypeCode.Boolean;
        }
        else if (typeof obj == "string" || obj instanceof String)
        {
            if (obj.length == 6 && obj.substring(0, 2) == "\\u")
            {
                return __System.TypeCode.Char;
            }
            else
            {
                return __System.TypeCode.String;
            }
        }
        else if (typeof obj  == "number" || obj instanceof Number)
        {
            if (obj.toString().indexOf(".") == -1)
            {
                if (obj > 0)
                {
                    if (obj <= 255)
                    {
                        return __System.TypeCode.Byte;
                    }
                    else if (obj <= 65535)
                    {
                        return __System.TypeCode.UInt16;
                    }
                    else if (obj <= 4294967295)
                    {
                        return __System.TypeCode.UInt32;
                    }
                    else
                    {
                        return __System.TypeCode.UInt64;
                    }
                }
                else
                {
                    if (obj >= -128 && obj <= 127)
                    {
                        return __System.TypeCode.SByte;
                    }
                    else if (obj >= -32768 && obj <= 32767)
                    {
                        return __System.TypeCode.Int16;
                    }
                    else if (obj >= -2147483648 && obj <= 2147483647)
                    {
                        return __System.TypeCode.Int32;
                    }
                    else
                    {
                        return __System.TypeCode.Int64;
                    }
                }
            }
            else
            {
                if (obj >= 1.5 * Math.pow(10, -45) && obj <= 3.4 * Math.pow(10, 38) && obj.toString().length - obj.toString().indexOf(".") - 1 <= 7)
                {
                    return __System.TypeCode.Single;
                }
                else if (obj >= 1.0 * Math.pow(10, -28) && obj <= 7.9 * Math.pow(10, 28) && obj.toString().length - obj.toString().indexOf(".") - 1 <= 29)
                {
                    return __System.TypeCode.Decimal;
                }
                else
                {
                    return __System.TypeCode.Double;
                }
            }
        }
        else
        {
            if (obj instanceof Date)
            {
                return __System.TypeCode.DateTime;
            }
            else if (obj == null)
            {
                return __System.TypeCode.Empty;
            }
            else
            {
                return __System.TypeCode.Object;
            }
        }
    },
    _IsBoolean: function(/*TypeCode*/ type)
    {
        // summary:
        //   Determines whether a type is a Boolean.
        //
        // arguments:
        //   type (required)
        //
        // returns: Boolean
        
        return (type == __System.TypeCode.Boolean);
    },
    _IsEmpty: function(/*TypeCode*/ type)
    {
        // summary:
        //   Determines whether a type is Empty.
        //
        // arguments:
        //   type (required)
        //
        // returns: Boolean
        
        return (type == __System.TypeCode.DBNull || type == __System.TypeCode.Empty);
    },
    _IsObject: function(/*TypeCode*/ type)
    {
        // summary:
        //   Determines whether a type is an Object.
        //
        // arguments:
        //   type (required)
        //
        // returns: Boolean
        
        return (type == __System.TypeCode.DBNull || type == __System.TypeCode.DateTime || type == __System.TypeCode.Empty || type == __System.TypeCode.Object);
    },
    _IsNumber: function(/*TypeCode*/ type)
    {
        // summary:
        //   Determines whether a type is a Number.
        //
        // arguments:
        //   type (required)
        //
        // returns: Boolean
        
        return (type == __System.TypeCode.Byte || type == __System.TypeCode.UInt16 || type == __System.TypeCode.UInt32 || type == __System.TypeCode.UInt64 || type == __System.TypeCode.SByte || type == __System.TypeCode.Int16 || type == __System.TypeCode.Int32 || type == __System.TypeCode.Int64 || type == __System.TypeCode.Single || type == __System.TypeCode.Double || type == __System.TypeCode.Decimal);
    },
    _IsString: function(/*TypeCode*/ type)
    {
        // summary:
        //   Determines whether a type is a String.
        //
        // arguments:
        //   type (required)
        //
        // returns: Boolean
        
        return (type == __System.TypeCode.String || type == __System.TypeCode.Char);
    }
}

__System.TypeCode =
{
    Boolean: 0,
    Byte: 1,
    Char: 2,
    DateTime: 3,
    DBNull: 6,
    Decimal: 4,
    Double: 5,
    Empty: 6,
    Int16: 7,
    Int32: 8,
    Int64: 9,
    Object: 10,
    SByte: 11,
    Single: 12,
    String: 13,
    UInt16: 14,
    UInt32: 15,
    UInt64: 16
}

__System.Import("System.Type", true);
