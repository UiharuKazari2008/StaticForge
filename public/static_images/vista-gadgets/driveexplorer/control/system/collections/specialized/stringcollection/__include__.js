////////////////////////////////////////////////////////////////////////////////
//
//  THIS CODE IS NOT APPROVED FOR USE IN/ON ANY OTHER UI ELEMENT OR PRODUCT COMPONENT.
//  Copyright (c) 2006 Microsoft Corporation.  All rights reserved.
//
////////////////////////////////////////////////////////////////////////////////

__System.Collections.Specialized.StringCollection = function(/*Collection*/ collection)
{
    var __ordered = [];
    var __this = this;
    
    this.Count = 0;
    
    function ___Properties(/*Integer*/ index, /*Integer*/ count)
    {
        // summary:
        //   Internal procedure to create data access features.
        //
        // arguments:
        //   index (optional)
        //   count (optional)
        //
        // returns: Nothing
        
        var n = __this.Count;
        
        __this.Count = __ordered.length;
        
        count = (count != null ? Math.min(index + count, __this.Count) : __this.Count);
        
        for (var i = (index != null ? index : 0); i < count; i++)
        {
            __this[i] = __ordered[i];
            __this.Item[i] =
            {
                index: i,
                get: function()
                {
                    return __ordered[this.index];
                },
                set: function(/*Object*/ value)
                {
                    __ordered[this.index] = value;
                    __this[this.index] = value;
                }
            }
        }
        
        for (var i = __this.Count; i < n; i++)
        {
            delete __this[i];
            delete __this.Item[i];
        }
    }
    
    ___Properties();
    
    this.Enumerator = function()
    {
        // summary:
        //   Enumerates the elements of a StringCollection.
        //
        // arguments:
        //   none
        //
        // returns: Nothing
        
        this.Count = __this.Count;
        this.Current = -1;
        
        this.MoveNext = function()
        {
            if (this.Current < this.Count - 1)
            {
                this.Current++;
                return true;
            }
            
            return false;
        }
        
        this.Reset = function()
        {
            this.Current = -1;
        }
    }
    
    this.Item = {
    
    }
    
    this.Add = function(/*Object*/ item)
    {
        // summary:
        //   Adds a string to the end of the StringCollection.
        //
        // arguments:
        //   item (required)
        //
        // returns: Nothing
        
        if (typeof item != "undefined")
        {
            this.Insert(this.Count, item);
        }
    }
    
    this.AddRange = function(/*Array*/ collection)
    {
        // summary:
        //   Copies the elements of a string array to the end
        //   of the StringCollection.
        //
        // arguments:
        //   collection (required)
        //
        // returns: Nothing
        
        if (collection != null)
        {
            var b = true;
            
            if (collection.splice != null || collection.Enumerator != null)
            {
                b = false;
                
                var o = [];
                
                if (collection.Enumerator != null)
                {
                    try
                    {
                        var o1 = collection.GetEnumerator();
                        
                        while (o1.MoveNext())
                        {
                            o.push(o1.Item[o1.Current].get());
                        }
                    }
                    catch (e)
                    {
                        b = true;
                    }
                }
                else
                {
                    o = collection;
                }
                
                if (!b)
                {
                    for (var i = 0; i < o.length; i++)
                    {
                        this.Add(o[i]);
                    }
                }
            }
            
            if (b)
            {
                this.Add(collection);
            }
        }
    }
    
    this.Clear = function()
    {
        // summary:
        //   Removes all the strings from the StringCollection.
        //
        // arguments:
        //   none
        //
        // returns: Nothing
        
        __ordered = [];
        this.Item = {};
        
        ___Properties();
    }
    
    this.Contains = function(/*Object*/ item)
    {
        // summary:
        //   Determines whether the specified string is in
        //   the StringCollection.
        //
        // arguments:
        //   item (required)
        //
        // returns: Boolean
        
        if (typeof item != "undefined")
        {
            return (this.IndexOf(item) != -1);
        }
        
        return false;
    }
    
    this.CopyTo = function(/*Array*/ collection, /*Integer*/ index, /*Integer*/ count)
    {
        // summary:
        //   Copies the entire StringCollection values to a
        //   one-dimensional array of strings, starting at
        //   the specified index of the target array.
        //
        // arguments:
        //   collection (required)
        //   index (optional)
        //   count (optional)
        //
        // returns: Nothing
        
        if (collection != null && collection.splice != null)
        {
            index = (index != null ? parseInt(index) : 0);
            var end = this.Count;
            
            if (index < 0 || index > this.Count - 1)
            {
                return -1;
            }
            
            if (count != null)
            {
                count = parseInt(count);
                
                if (count < 0)
                {
                    return -1;
                }
                
                end = Math.min(index + count, this.Count);
            }
            
            for (var i = index; i < end; i++)
            {
                collection[i] = __ordered[i];
            }
            
            if (collection.length > i)
            {
                collection.splice(i, collection.length - i);
            }
        }
    }
    
    this.Equals = function(/*Object*/ obj0, /*Object*/ obj1)
    {
        // summary:
        //   Determines whether two Object instances are equal.
        //
        // arguments:
        //   obj0 (required)
        //   obj1 (optional)
        //
        // returns: Boolean
        
        obj1 = (obj1 != null ? obj1 : this);
        
        if (obj0.Count == obj1.Count)
        {
            for (var i = 0; i < obj0.Count; i++)
            {
                if (obj0[i] != obj1[i] || typeof obj0[i] != typeof obj1[i])
                {
                    return false;
                }
            }
            
            return true;
        }
        
        return false;
    }
    
    this.GetEnumerator = function()
    {
        // summary:
        //   Returns a StringEnumerator that iterates through
        //   the StringCollection.
        //
        // arguments:
        //   none
        //
        // returns: Nothing
        
        return new this.Enumerator();
    }
    
    this.IndexOf = function(/*Object*/ item, /*Integer*/ index, /*Integer*/ count)
    {
        // summary:
        //   Searches for the specified string and returns the
        //   zero-based index of the first occurrence within
        //   the StringCollection.
        //
        // arguments:
        //   item (required)
        //   index (optional)
        //   count (optional)
        //
        // returns: Integer
        
        if (typeof item != "undefined")
        {
            index = (index != null ? parseInt(index) : 0);
            var end = this.Count;
            
            if (index < 0 || index > this.Count - 1)
            {
                return -1;
            }
            
            if (count != null)
            {
                count = parseInt(count);
                
                if (count < 0)
                {
                    return -1;
                }
                
                end = Math.min(index + count, this.Count);
            }
            
            for (var i = index; i < end; i++)
            {
                if (__ordered[i] == item && typeof __ordered[i] == typeof item)
                {
                    return i;
                }
            }
        }
        
        return -1;
    }
    
    this.Insert = function(/*Integer*/ index, /*Object*/ item)
    {
        // summary:
        //   Inserts a string into the StringCollection at the
        //   specified index.
        //
        // arguments:
        //   index (required)
        //   item (required)
        //
        // returns: Nothing
        
        if (index != null && typeof item != "undefined")
        {
            if (index >= 0)
            {
                index = Math.min(index, this.Count);
                __ordered.splice(index, 0, item);
                
                ___Properties();
            }
        }
    }
    
    this.ReferenceEquals = function(/*Object*/ obj0, /*Object*/ obj1)
    {
        // summary:
        //   Determines whether the specified Object instances
        //   are the same instance.
        //
        // arguments:
        //   obj0 (required)
        //   obj1 (required)
        //
        // returns: Boolean
        
        return __System.Object.ReferenceEquals(obj0, (obj1 != null ? obj1 : this));
    }
    
    this.Remove = function(/*Object*/ item)
    {
        // summary:
        //   Removes the first occurrence of a specific string
        //   from the StringCollection.
        //
        // arguments:
        //   item (required)
        //
        // returns: Nothing
        
        if (typeof item != "undefined")
        {
            var n = this.IndexOf(item);
            
            if (n != -1)
            {
                this.RemoveAt(n);
            }
        }
    }
    
    this.RemoveAt = function(/*Integer*/ index)
    {
        // summary:
        //   Removes the string at the specified index of the
        //   StringCollection.
        //
        // arguments:
        //   index (required)
        //
        // returns: Nothing
        
        if (index != null)
        {
            if (index >= 0 && index < this.Count)
            {
                __ordered.splice(index, 1);
                
                ___Properties();
            }
        }
    }
    
    this.ToString = function()
    {
        // summary:
        //   Returns a String that represents the current Object.
        //
        // arguments:
        //   none
        //
        // returns: String
        
        return __ordered.toString();
    }
    
    if (collection != null)
    {
        if (collection.splice != null || collection.Enumerator != null)
        {
            this.AddRange(collection);
        }
    }
}

__System.Import("System.Collections.Specialized.StringCollection", true);
