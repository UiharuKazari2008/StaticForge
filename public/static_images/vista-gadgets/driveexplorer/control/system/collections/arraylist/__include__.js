////////////////////////////////////////////////////////////////////////////////
//
//  THIS CODE IS NOT APPROVED FOR USE IN/ON ANY OTHER UI ELEMENT OR PRODUCT COMPONENT.
//  Copyright (c) 2006 Microsoft Corporation.  All rights reserved.
//
////////////////////////////////////////////////////////////////////////////////

__System.Collections.ArrayList = function(/*Collection|Integer*/ capacity)
{
    var __ordered = [];
    var __this = this;
    
    this.Capacity = -1;
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
        //   Enumerates the elements of a ArrayList.
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
        //   Adds an object to the end of the ArrayList.
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
        //   Adds the elements to the end of the ArrayList.
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
    
    this.BinarySearch = function(/*Object*/ item)
    {
        // summary:
        //   Uses a binary search algorithm to locate a specific
        //   element in the sorted ArrayList or a portion of it.
        //
        // arguments:
        //   item (required)
        //
        // returns: Object
        
        return this.Find(item);
    }
    
    this.Clear = function()
    {
        // summary:
        //   Removes all elements from the ArrayList.
        //
        // arguments:
        //   none
        //
        // returns: Nothing
        
        __ordered = [];
        this.Item = {};
        
        ___Properties();
    }
    
    this.Clone = function()
    {
        // summary:
        //   Creates a shallow copy of the ArrayList.
        //
        // arguments:
        //   none
        //
        // returns: Array
        
        return this.ToArray();
    }
    
    this.Contains = function(/*Object*/ item)
    {
        // summary:
        //   Determines whether an element is in the ArrayList.
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
        //   Copies the ArrayList or a portion of it to a
        //   one-dimensional array.
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
        //   Returns an enumerator that iterates through
        //   the ArrayList.
        //
        // arguments:
        //   none
        //
        // returns: Nothing
        
        return new this.Enumerator();
    }
    
    this.GetRange = function(/*Integer*/ index, /*Integer*/ count)
    {
        // summary:
        //   Returns an ArrayList which represents a subset of
        //   the elements in the source ArrayList.
        //
        // arguments:
        //   index (required)
        //   count (required)
        //
        // returns: Nothing
        
        var o = [];
        
        return this.CopyTo(o, index, count);
    }
    
    this.IndexOf = function(/*Object*/ item, /*Integer*/ index, /*Integer*/ count)
    {
        // summary:
        //   Returns the zero-based index of the first occurrence
        //   of a value in the ArrayList or in a portion of it.
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
        //   Inserts an element into the ArrayList at the
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
                
                ___Properties(index);
            }
        }
    }
    
    this.InsertRange = function(/*Integer*/ index, /*Array*/ collection)
    {
        // summary:
        //   Inserts the elements of a collection into the
        //   ArrayList at the specified index.
        //
        // arguments:
        //   index (required)
        //   collection (required)
        //
        // returns: Nothing
        
        if (collection != null)
        {
            if (collection.splice != null || collection.__ordered != null)
            {
                if (index >= 0)
                {
                    index = Math.min(index, this.Count);
                    
                    var o = (collection.__ordered != null ? collection.__ordered : collection);
                    
                    for (var i = 0; i < o.length; i++)
                    {
                        this.Insert(index + i, o[i]);
                    }
                }
            }
        }
    }
    
    this.LastIndexOf = function(/*Object*/ item, /*Integer*/ index, /*Integer*/ count)
    {
        // summary:
        //   Returns the zero-based index of the last occurrence
        //   of a value in the ArrayList or in a portion of it.
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
            
            for (var i = end; i >= index; i--)
            {
                if (__ordered[i] == item && typeof __ordered[i] == typeof item)
                {
                    return i;
                }
            }
        }
        
        return -1;
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
        //   Removes the first occurrence of a specific object
        //   from the ArrayList.
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
        //   Removes the element at the specified index of
        //   the ArrayList.
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
                
                ___Properties(index);
            }
        }
    }
    
    this.RemoveRange = function(/*Integer*/ index, /*Integer*/ count)
    {
        // summary:
        //   Removes a range of elements from the ArrayList.
        //
        // arguments:
        //   index (required)
        //   count (required)
        //
        // returns: Nothing
        
        if (index != null && count != null)
        {
            if (index >= 0 && index < this.Count)
            {
                count = Math.min(index + count, this.Count);
                
                for (var i = index; i < count; i++)
                {
                    this.RemoveAt(index);
                }
            }
        }
    }
    
    this.Repeat = function(/*Object*/ value, /*Integer*/ count)
    {
        // summary:
        //   Returns an ArrayList whose elements are copies of the
        //   specified value.
        //
        // arguments:
        //   value (required)
        //   count (required)
        //
        // returns: Array
        
        if (value != null && count != null)
        {
            var o = new __System.Collections.ArrayList(count);
            
            for (var i = 0; i < count; i++)
            {
                o.Add(value);
            }
            
            return o;
        }
    }
    
    this.Reverse = function(/*Integer*/ index, /*Integer*/ count)
    {
        // summary:
        //   Reverses the order of the elements in the ArrayList or a
        //   portion of it.
        //
        // arguments:
        //   index (required)
        //   count (required)
        //
        // returns: Nothing
        
        if (count != null && index >= 0 && index < this.Count)
        {
            var o = [];
            
            for (var i = 0; i < index; i++)
            {
                o.push(__ordered[i]);
            }
            
            for (var i = Math.min(index + count, this.Count) - 1; i >= index; i--)
            {
                o.push(__ordered[i]);
            }
            
            for (var i = Math.min(index + count, this.Count); i < this.Count; i++)
            {
                o.push(__ordered[i]);
            }
            
            __ordered = o;
        }
        else if (index == null)
        {
            __ordered.reverse();
        }
    }
    
    this.SetRange = function(/*Integer*/ index, /*Array*/ collection)
    {
        // summary:
        //   Copies the elements of a collection over a range of
        //   elements in the ArrayList.
        //
        // arguments:
        //   index (required)
        //   collection (required)
        //
        // returns: Nothing
        
        if (collection != null)
        {
            if (collection.splice != null || collection.__ordered != null)
            {
                if (index >= 0)
                {
                    index = Math.min(index, this.Count);
                    
                    var o = (collection.__ordered != null ? collection.__ordered : collection);
                    
                    for (var i = 0; i < o.length; i++)
                    {
                        __ordered[index + i] = o[i];
                    }
                    
                    ___Properties(index);
                }
            }
        }
    }
    
    this.Sort = function(/*Function|Integer*/ arg0, /*Function|Integer*/ arg1, /*Function*/ arg2)
    {
        // summary:
        //   Sorts the elements in the ArrayList or a portion
        //   of it.
        //
        // arguments:
        //   arg0 (required)
        //   arg1 (optional)
        //   arg2 (optional)
        //
        // returns: Nothing
        
        if (arg0 == null)
        {
            __ordered.sort();
            
            ___Properties();
        }
        else
        {
            var index = 0;
            var count = this.Count;
            var predicate = arg0;
            
            if (arg2 != null)
            {
                index = parseInt(arg0);
                count = parseInt(arg1);
                predicate = arg2;
            }
            
            if (predicate == null || index < 0 || index > this.Count - 1 || count < 0)
            {
                return;
            }
            
            var o = [];
            var unsorted = [];
            var sorted = [];
            
            for (var i = 0; i < index; i++)
            {
                o.push(__ordered[i]);
            }
            
            for (var i = index; i < Math.min(index + count, this.Count); i++)
            {
                unsorted.push(__ordered[i]);
            }
            
            if (predicate.Compare != null)
            {
                predicate = predicate.Compare;
            }
            
            for (var i = 0; i < unsorted.length; i++)
            {
                for (var j = 0; j < sorted.length; j++)
                {
                    if (predicate(unsorted[i], sorted[j]) == 1)
                    {
                        sorted.splice(Math.max(0, j - 1), 0, unsorted[i]);
                        break;
                    }
                }
                
                if (sorted.length <= i)
                {
                    sorted.push(unsorted[i]);
                }
            }
            
            for (var i = 0; i < sorted.length; i++)
            {
                o.push(sorted[i]);
            }
            
            for (var i = Math.min(index + count, this.Count); i < this.Count; i++)
            {
                o.push(__ordered[i]);
            }
            
            __ordered = o;
            
            ___Properties(index, count);
        }
    }    
    
    this.ToArray = function(/*Array*/ collection)
    {
        // summary:
        //   Copies the elements of the ArrayList to a new array.
        //
        // arguments:
        //   collection (optional)
        //
        // returns: Array
        
        var o = (collection != null ? collection : []);
        
        this.CopyTo(o);
        
        return o;
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
    
    this.TrimToSize = function()
    {
        // summary:
        //   Sets the capacity to the actual number of elements in
        //   the ArrayList.
        //
        // arguments:
        //   none
        //
        // returns: Nothing
        
        if (this.__count != -1)
        {
            this.RemoveRange(this.Capacity, this.Count - this.Capacity);
        }
    }
    
    if (capacity != null)
    {
        if (capacity.splice != null || capacity.Enumerator != null)
        {
            this.AddRange(capacity);
        }
        else if (!isNaN(parseInt(capacity)))
        {
            this.Capacity = parseInt(capacity);
        }
    }
}

__System.Import("System.Collections.ArrayList", true);
