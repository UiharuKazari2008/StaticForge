# frozen_string_literal: true

require "dtext/dtext"
require "dtext/version"
require "dtext/ruby"

class DText
  class Error < StandardError; end

  # Match official Danbooru dtext_rb gem API exactly
  # https://github.com/danbooru/danbooru/tree/master/lib/dtext_rb
  # Additional: source parameter for custom CSS classes and wiki link handling
  def self.parse(str, inline: false, media_embeds: true, disable_mentions: false, base_url: nil, domain: nil, internal_domains: [], emoji_list: [], source: nil)
    # Detect source from base_url if not provided
    if source.nil? && base_url
      source = base_url.include?('e621.net') ? 'e621' : 'danbooru'
    end
    source ||= 'danbooru'
    
    # Try C++ extension first (official gem behavior)
    if respond_to?(:c_parse, true)
      begin
        html = c_parse(str, base_url, domain, internal_domains, emoji_list, inline, disable_mentions, media_embeds, source)
        
        # Post-process C++ output - minimal adjustments
        require "cgi"
        
        # Fix anchor links - convert full URLs back to fragment-only for # links
        html = html.gsub(/href="https?:\/\/[^"]*#([^"]+)"/, 'href="#\1"')
        html = html.gsub(/href="https?:\/\/[^"]*#([^"]+)"/, 'href="#\1"') # Run twice for nested cases
        
        # No other post-processing needed - C++ code handles:
        # - Native <details>/<summary> for expand blocks
        # - tag-wiki-link class and data attributes for wiki links
        # - Source-specific classes
        # - Section tags
        
        return html
      rescue => e
        # If C++ extension fails, fall back to Ruby (our addition for compatibility)
        # puts "C++ extension failed, using Ruby fallback: #{e.message}"
      end
    end
    
    # Fall back to Ruby parser if C++ extension not available
    # Set source in Ruby parser for custom handling
    DText::Ruby.instance_variable_set(:@source, source) if source
    DText::Ruby.parse(str, inline: inline, media_embeds: media_embeds, disable_mentions: disable_mentions, base_url: base_url, domain: domain, internal_domains: internal_domains, emoji_list: emoji_list)
  end
end
