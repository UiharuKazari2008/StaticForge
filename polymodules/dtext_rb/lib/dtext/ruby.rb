require 'cgi'
require 'uri'

class DText
  class Ruby
    MENTION_REGEXP = /(?<=^| )@\S+/

    def self.u(string)
      CGI.escape(string)
    end

    def self.h(string)
      CGI.escapeHTML(string)
    end

    def self.strip_blocks(string, tag)
      blocks = string.scan(/\[\/?#{tag}\]|.+?(?=\[\/?#{tag}\]|$)/m)
      n = 0
      stripped = ""
      blocks.each do |block|
        case block
        when "[#{tag}]"
          n += 1

        when "[/#{tag}]"
          n -= 1

        else
          if n == 0
            stripped += block
          end
        end
      end

      stripped.strip
    end

    def self.parse_inline(str, options = {})
      str.gsub!(/&/, "&amp;")
      str.gsub!(/</, "&lt;")
      str.gsub!(/>/, "&gt;")
      str.gsub!(/\n/m, "<br>") unless options[:ignore_newlines]
      str.gsub!(/\[b\](.+?)\[\/b\]/i, '<strong>\1</strong>')
      str.gsub!(/\[i\](.+?)\[\/i\]/i, '<em>\1</em>')
      str.gsub!(/\[s\](.+?)\[\/s\]/i, '<s>\1</s>')
      str.gsub!(/\[u\](.+?)\[\/u\]/i, '<u>\1</u>')
      str.gsub!(/\[tn\](.+?)\[\/tn\]/i, '<p class="tn">\1</p>')

      str = parse_mentions(str)
      str = parse_links(str)
      str = parse_aliased_wiki_links(str)
      str = parse_wiki_links(str)
      str = parse_post_links(str)
      str = parse_id_links(str)
      str
    end

    def self.parse_mentions(str)
      base = @base_url || 'https://danbooru.donmai.us'
      str.gsub!(MENTION_REGEXP) do |name|
        next name unless name =~ /[a-z0-9]/i

        if name =~ /([:;,.!?\)\]<>])$/
          name.chop!
          ch = $1
        else
          ch = ""
        end

        user_name = CGI.unescapeHTML(name[1..-1])
        user_url = base + '/users?name=' + u(user_name)
        %{<a href="#{user_url}" class="tag-wiki-external-link" target="_blank" rel="noopener noreferrer">#{name}</a>} + ch
      end
      str
    end

    def self.parse_table_elements(str)
      str = parse_inline(str, :ignore_newlines => true)
      str.gsub!(/\[(\/?(?:tr|td|th|thead|tbody))\]/, '<\1>')
      str
    end

    def self.parse_links(str)
      str.gsub(/("[^"]+":(https?:\/\/|\/)[^\s\r\n<>]+|https?:\/\/[^\s\r\n<>]+|"[^"]+":\[(https?:\/\/|\/)[^\s\r\n<>\]]+\])+/) do |url|
        ch = ""

        if url =~ /^"([^"]+)":\[(.+)\]$/
          text = $1
          url = $2
        else
          if url =~ /^"([^"]+)":(.+)$/
            text = $1
            url = $2
          else
            text = url
          end

          if url =~ /([;,.!?\)\]<>])$/
            url.chop!
            ch = $1
          end
        end

        # Determine link type and add appropriate classes/attributes
        classes = []
        target_attr = ''
        rel_attr = ''
        final_url = url

        if url.start_with?('#')
          # Anchor link (points to header)
          classes << 'tag-wiki-anchor-link'
          final_url = url
        elsif url.start_with?('/') && !url.start_with?('//')
          # Internal site link - convert to full URL and open in new tab
          final_url = (@base_url || 'https://danbooru.donmai.us') + url
          classes << 'tag-wiki-external-link'
          target_attr = ' target="_blank"'
          rel_attr = ' rel="noopener noreferrer"'
        elsif url =~ /^https?:\/\//i
          # External link - check for specific domains and add classes
          classes << 'tag-wiki-external-link'
          target_attr = ' target="_blank"'
          rel_attr = ' rel="noopener noreferrer"'
          
          # Add specific domain classes
          case url.downcase
          when /pixiv\.net/
            classes << 'tag-wiki-pixiv-link'
          when /twitter\.com|x\.com/
            classes << 'tag-wiki-twitter-link'
          when /pawoo\.net/
            classes << 'tag-wiki-pawoo-link'
          when /seiga\.nicovideo\.jp/
            classes << 'tag-wiki-seiga-link'
          when /nijie\.jp/
            classes << 'tag-wiki-nijie-link'
          when /deviantart\.com/
            classes << 'tag-wiki-deviantart-link'
          when /artstation\.com/
            classes << 'tag-wiki-artstation-link'
          when /sankakucomplex\.com/
            classes << 'tag-wiki-sankaku-link'
          when /gelbooru\.com/
            classes << 'tag-wiki-gelbooru-link'
          when /yande\.re/
            classes << 'tag-wiki-yandere-link'
          when /github\.com/
            classes << 'tag-wiki-issue-link'
          end
          
          final_url = url
        else
          # Other links - leave as-is
          final_url = url
        end

        class_attr = classes.any? ? %{ class="#{classes.join(' ')}"} : ''
        %{<a href="#{final_url}"#{class_attr}#{target_attr}#{rel_attr}>#{h(text)}</a>} + ch
      end
    end

    def self.parse_aliased_wiki_links(str)
      str.gsub(/\[\[([^\|\]]+)\|([^\]]+)\]\]/m) do
        text = CGI.unescapeHTML($2)
        full_title = CGI.unescapeHTML($1)
        # Handle wiki links with anchors: [[tag#section]]
        if full_title.include?('#')
          title, anchor = full_title.split('#', 2)
          anchor = (anchor || '').downcase
          # Store both tag name and anchor for client-side handling
          %{<span class="tag-wiki-link" data-tag-name="#{h(title)}" data-anchor="#{h(anchor)}">#{h(text)}</span>}
        else
          %{<span class="tag-wiki-link" data-tag-name="#{h(full_title)}">#{h(text)}</span>}
        end
      end
    end

    def self.parse_wiki_links(str)
      str.gsub(/\[\[([^\]]+)\]\]/) do
        full_text = CGI.unescapeHTML($1)
        # Handle wiki links with anchors: [[tag#section]]
        if full_text.include?('#')
          title, anchor = full_text.split('#', 2)
          anchor = (anchor || '').downcase
          text = full_text # Keep original text for display
          %{<span class="tag-wiki-link" data-tag-name="#{h(title)}" data-anchor="#{h(anchor)}">#{h(text)}</span>}
        else
          %{<span class="tag-wiki-link" data-tag-name="#{h(full_text)}">#{h(full_text)}</span>}
        end
      end
    end

    def self.parse_post_links(str)
      base = @base_url || 'https://danbooru.donmai.us'
      str.gsub(/\{\{([^\}]+)\}\}/) do
        tags = CGI.unescapeHTML($1)
        %{<a href="#{base}/posts?tags=#{u(tags)}" class="tag-wiki-external-link" target="_blank" rel="noopener noreferrer">#{h(tags)}</a>}
      end
    end

    def self.parse_id_links(str)
      base = @base_url || 'https://danbooru.donmai.us'
      external_class = ' class="tag-wiki-external-link"'
      external_attrs = ' target="_blank" rel="noopener noreferrer"'
      
      # Internal ID links (open in new tab)
      str = str.gsub(/\bpost #(\d+)/i, %{<a href="#{base}/posts/\\1"#{external_class}#{external_attrs}>post #\\1</a>})
      str = str.gsub(/\bforum #(\d+)/i, %{<a href="#{base}/forum_posts/\\1"#{external_class}#{external_attrs}>forum #\\1</a>})
      str = str.gsub(/\btopic #(\d+)(?!\/p\d|\d)/i, %{<a href="#{base}/forum_topics/\\1"#{external_class}#{external_attrs}>topic #\\1</a>})
      str = str.gsub(/\btopic #(\d+)\/p(\d+)/i, %{<a href="#{base}/forum_topics/\\1?page=\\2"#{external_class}#{external_attrs}>topic #\\1/p\\2</a>})
      str = str.gsub(/\bcomment #(\d+)/i, %{<a href="#{base}/comments/\\1"#{external_class}#{external_attrs}>comment #\\1</a>})
      str = str.gsub(/\bpool #(\d+)/i, %{<a href="#{base}/pools/\\1"#{external_class}#{external_attrs}>pool #\\1</a>})
      str = str.gsub(/\buser #(\d+)/i, %{<a href="#{base}/users/\\1"#{external_class}#{external_attrs}>user #\\1</a>})
      str = str.gsub(/\bartist #(\d+)/i, %{<a href="#{base}/artists/\\1"#{external_class}#{external_attrs}>artist #\\1</a>})
      str = str.gsub(/\bwiki #(\d+)/i, %{<a href="#{base}/wiki_pages/\\1"#{external_class}#{external_attrs}>wiki #\\1</a>})
      str = str.gsub(/\bfavgroup #(\d+)/i, %{<a href="#{base}/favorite_groups/\\1"#{external_class}#{external_attrs}>favgroup #\\1</a>})
      str = str.gsub(/\bban #(\d+)/i, %{<a href="#{base}/bans/\\1"#{external_class}#{external_attrs}>ban #\\1</a>})
      str = str.gsub(/\bfeedback #(\d+)/i, %{<a href="#{base}/user_feedbacks/\\1"#{external_class}#{external_attrs}>feedback #\\1</a>})
      str = str.gsub(/\bappeal #(\d+)/i, %{<a href="#{base}/post_appeals/\\1"#{external_class}#{external_attrs}>appeal #\\1</a>})
      str = str.gsub(/\bflag #(\d+)/i, %{<a href="#{base}/post_flags/\\1"#{external_class}#{external_attrs}>flag #\\1</a>})
      str = str.gsub(/\bnote #(\d+)/i, %{<a href="#{base}/notes/\\1"#{external_class}#{external_attrs}>note #\\1</a>})
      str = str.gsub(/\bBUR #(\d+)/i, %{<a href="#{base}/bulk_update_requests/\\1"#{external_class}#{external_attrs}>BUR #\\1</a>})
      str = str.gsub(/\balias #(\d+)/i, %{<a href="#{base}/tag_aliases/\\1"#{external_class}#{external_attrs}>alias #\\1</a>})
      str = str.gsub(/\bimplication #(\d+)/i, %{<a href="#{base}/tag_implications/\\1"#{external_class}#{external_attrs}>implication #\\1</a>})
      str = str.gsub(/\bmod action #(\d+)/i, %{<a href="#{base}/mod_actions/\\1"#{external_class}#{external_attrs}>mod action #\\1</a>})
      
      # External ID links (with specific classes)
      str = str.gsub(/\bissue #(\d+)/i, %{<a href="https://github.com/danbooru/danbooru/issues/\\1" class="tag-wiki-external-link tag-wiki-issue-link" target="_blank" rel="noopener noreferrer">issue #\\1</a>})
      str = str.gsub(/\bpixiv #(\d+)(?!\/p\d|\d)/i, %{<a href="https://www.pixiv.net/artworks/\\1" class="tag-wiki-external-link tag-wiki-pixiv-link" target="_blank" rel="noopener noreferrer">pixiv #\\1</a>})
      str = str.gsub(/\bpixiv #(\d+)\/p(\d+)/i, %{<a href="https://www.pixiv.net/artworks/\\1#manga" class="tag-wiki-external-link tag-wiki-pixiv-link" target="_blank" rel="noopener noreferrer">pixiv #\\1/p\\2</a>})
      str = str.gsub(/\bpawoo #(\d+)/i, %{<a href="https://pawoo.net/web/statuses/\\1" class="tag-wiki-external-link tag-wiki-pawoo-link" target="_blank" rel="noopener noreferrer">pawoo #\\1</a>})
      str = str.gsub(/\bseiga #(\d+)/i, %{<a href="https://seiga.nicovideo.jp/seiga/im\\1" class="tag-wiki-external-link tag-wiki-seiga-link" target="_blank" rel="noopener noreferrer">seiga #\\1</a>})
      str = str.gsub(/\bnijie #(\d+)/i, %{<a href="https://nijie.info/view.php?id=\\1" class="tag-wiki-external-link tag-wiki-nijie-link" target="_blank" rel="noopener noreferrer">nijie #\\1</a>})
      str = str.gsub(/\btwitter #(\d+)/i, %{<a href="https://twitter.com/i/web/status/\\1" class="tag-wiki-external-link tag-wiki-twitter-link" target="_blank" rel="noopener noreferrer">twitter #\\1</a>})
      str = str.gsub(/\bdeviantart #(\d+)/i, %{<a href="https://www.deviantart.com/deviation/\\1" class="tag-wiki-external-link tag-wiki-deviantart-link" target="_blank" rel="noopener noreferrer">deviantart #\\1</a>})
      str = str.gsub(/\bartstation #(\d+)/i, %{<a href="https://www.artstation.com/artwork/\\1" class="tag-wiki-external-link tag-wiki-artstation-link" target="_blank" rel="noopener noreferrer">artstation #\\1</a>})
      str = str.gsub(/\bsankaku #(\d+)/i, %{<a href="https://chan.sankakucomplex.com/post/show/\\1" class="tag-wiki-external-link tag-wiki-sankaku-link" target="_blank" rel="noopener noreferrer">sankaku #\\1</a>})
      str = str.gsub(/\bgelbooru #(\d+)/i, %{<a href="https://gelbooru.com/index.php?page=post&s=view&id=\\1" class="tag-wiki-external-link tag-wiki-gelbooru-link" target="_blank" rel="noopener noreferrer">gelbooru #\\1</a>})
      str = str.gsub(/\byandere #(\d+)/i, %{<a href="https://yande.re/post/show/\\1" class="tag-wiki-external-link tag-wiki-yandere-link" target="_blank" rel="noopener noreferrer">yandere #\\1</a>})
    end

    def self.parse_list(str, options = {})
      html = ""
      current_item = ""
      layout = []
      nest = 0

      str.split(/\n/).each do |line|
        if line =~ /^\s*(\*+) (.+)/
          if nest > 0
            html += "<li>#{current_item}</li>"
          elsif not current_item.strip.empty?
            html += "<p>#{current_item}</p>"
          end

          nest = $1.size
          current_item = parse_inline($2)
        else
          current_item += parse_inline(line)
        end

        if nest > layout.size
          html += "<ul>"
          layout << "ul"
        end

        while nest < layout.size
          elist = layout.pop
          if elist
            html += "</#{elist}>"
          end
        end
      end

      html += "<li>#{current_item}</li>"

      while layout.any?
        elist = layout.pop
        html += "</#{elist}>"
      end

      html
    end

    def self.parse(str, options = {})
      return "" if str.nil?
      str = str.dup
      
      # Get source and base_url from options
      source = options[:source] || 'danbooru'
      @base_url = options[:base_url] || (source == 'e621' ? 'https://e621.net' : 'https://danbooru.donmai.us')

      # Make sure quote tags are surrounded by newlines

      unless options[:inline]
        str.gsub!(/\s*\[quote\](?!\])\s*/m, "\n\n[quote]\n\n")
        str.gsub!(/\s*\[\/quote\]\s*/m, "\n\n[/quote]\n\n")
        str.gsub!(/\s*\[code\](?!\])/m, "\n\n[code]\n\n")
        str.gsub!(/\[\/code\]\s*/m, "\n\n[/code]\n\n")
        str.gsub!(/\s*\[spoilers?\](?!\])\s*/m, "\n\n[spoiler]\n\n")
        str.gsub!(/\s*\[\/spoilers?\]\s*/m, "\n\n[/spoiler]\n\n")
        str.gsub!(/^(h[1-6]\.\s*.+)$/, "\n\n\\1\n\n")
        str.gsub!(/\s*\[expand(\=[^\]]*)?\](?!\])\s*/m, "\n\n[expand\\1]\n\n")
        str.gsub!(/\s*\[\/expand\]\s*/m, "\n\n[/expand]\n\n")
        str.gsub!(/\s*\[table\](?!\])\s*/m, "\n\n[table]\n\n")
        str.gsub!(/\s*\[\/table\]\s*/m, "\n\n[/table]\n\n")
      end

      str.gsub!(/(?:\r?\n){3,}/, "\n\n")
      str.strip!
      blocks = str.split(/(?:\r?\n){2}/)
      stack = []
      flags = {}

      html = blocks.map do |block|
        case block
        when /\A(h[1-6])\.\s*(.+)\Z/
          tag = $1
          content = $2

          if options[:inline]
            "<h6>" + parse_inline(content, options) + "</h6>"
          else
            "<#{tag}>" + parse_inline(content, options) + "</#{tag}>"
          end

        when /^\s*\*+ /
          parse_list(block, options)

        when "[quote]"
          if options[:inline]
            ""
          else
            stack << "blockquote"
            "<blockquote>"
          end

        when "[/quote]"
          if options[:inline]
            ""
          elsif stack.last == "blockquote"
            stack.pop
            '</blockquote>'
          else
            ""
          end

        when "[spoiler]"
          stack << "spoiler"
          '<div class="spoiler">'

        when "[/spoiler]"
          if stack.last == "spoiler"
            stack.pop
            "</div>"
          else
            ""
          end

        when "[table]"
          stack << "table"
          flags[:table] = true
          '<table class="striped">'

        when "[/table]"
          if stack.last == "table"
            stack.pop
            flags[:table] = false
            "</table>"
          else
            ""
          end

        when /\[code\](?!\])/
          flags[:code] = true
          stack << "pre"
          '<pre>'

        when /\[\/code\](?!\])/
          flags[:code] = false
          if stack.last == "pre"
            stack.pop
            "</pre>"
          else
            ""
          end

        when /\[expand(?:\=([^\]]*))?\](?!\])/
          stack << "expandable"
          expand_html = '<div class="expandable"><div class="expandable-header">'
          expand_html << "<span>#{h($1)}</span>" if $1
          expand_html << '<input type="button" value="Show" class="expandable-button"/></div>'
          expand_html << '<div class="expandable-content">'
          expand_html

        when /\[\/expand\](?!\])/
          if stack.last == "expandable"
            stack.pop
            '</div></div>'
          end

        else
          if flags[:code]
            CGI.escape_html(block) + "\n\n"
          elsif flags[:table]
            parse_table_elements(block)
          else
            '<p>' + parse_inline(block) + '</p>'
          end
        end
      end

      stack.reverse.each do |tag|
        if tag == "blockquote"
          html << "</blockquote>"
        elsif tag == "div"
          html << "</div>"
        elsif tag == "pre"
          html << "</pre>"
        elsif tag == "spoiler"
          html << "</div>"
        elsif tag == "expandable"
          html << "</div></div>"
        elsif tag == "table"
          html << "</table>"
        end
      end

      html.join("")
    end
  end
end
