#!/usr/bin/env ruby
# DText Parser - Persistent Service
# Runs continuously, reading JSON requests from stdin and writing JSON responses to stdout
# Protocol: Each request is a JSON object on a single line, response is a JSON object on a single line

require 'json'

# Try to load dtext_rb gem, but don't exit if it's not available
# Instead, return errors for each request
dtext_rb_available = false
dtext_rb_error = nil

# Load dtext_rb from local polymodules folder (pure Ruby implementation)
begin
  dtext_rb_path = File.join(File.dirname(__FILE__), 'dtext_rb', 'lib')
  if File.directory?(dtext_rb_path)
    # Add the dtext_rb/lib directory to the load path
    $LOAD_PATH.unshift(dtext_rb_path) unless $LOAD_PATH.include?(dtext_rb_path)
    # Load the pure Ruby implementation
    require 'dtext'
    
    if defined?(DText::Ruby) && DText::Ruby.respond_to?(:parse)
      dtext_rb_available = true
    elsif defined?(DTextR) && DTextR.respond_to?(:parse)
      dtext_rb_available = true
    elsif defined?(DText) && DText.respond_to?(:parse)
      dtext_rb_available = true
      DTextR = DText unless defined?(DTextR)
    else
      dtext_rb_error = "DText::Ruby.parse not found after loading dtext"
    end
  else
    dtext_rb_error = "dtext_rb library not found in polymodules/dtext_rb/lib"
  end
rescue LoadError => e
  dtext_rb_error = "Failed to load dtext_rb: #{e.message}"
end

# Main service loop
# Read JSON requests from stdin line by line
# Exit when stdin closes (EOF) - this happens when parent process closes stdin
begin
  $stdin.each_line do |line|
    begin
      # Parse JSON request
      request = JSON.parse(line.strip)
      
      # Validate request structure
      unless request.is_a?(Hash)
        request_id = nil
        response = {
          success: false,
          error: "Invalid request format. Expected: {\"dtext\": \"...\"}",
          request_id: request_id
        }
        puts JSON.generate(response)
        $stdout.flush
        next
      end
      
      # Validate dtext field - must be present and not nil
      dtext_content = request['dtext']
      if dtext_content.nil?
        # Log to stderr for debugging - this indicates a bug in the JavaScript side
        $stderr.puts "ERROR: dtext_parser received nil dtext_content. This indicates a bug upstream."
        $stderr.puts "Request: #{request.inspect}"
        $stderr.puts "Request ID: #{request['request_id']}"
        response = {
          success: false,
          error: "Invalid request format. 'dtext' field is required and cannot be null",
          request_id: request['request_id']
        }
        puts JSON.generate(response)
        $stdout.flush
        next
      end
      
      # Log if empty string (also suspicious)
      if dtext_content.is_a?(String) && dtext_content.strip.empty?
        $stderr.puts "WARNING: dtext_parser received empty string. Request ID: #{request['request_id']}"
      end
      
      # Convert dtext to string if it's not already (handles edge cases)
      dtext_content = dtext_content.to_s if dtext_content
      
      # Check if dtext_rb is available
      unless dtext_rb_available && (defined?(DText::Ruby) || defined?(DTextR))
        response = {
          success: false,
          error: dtext_rb_error || "dtext_rb gem not available",
          request_id: request['request_id']
        }
        puts JSON.generate(response)
        $stdout.flush
        next
      end
      
      # Parse DText to HTML
      source = request['source'] || 'danbooru'
      base_url = request['base_url'] || (source == 'e621' ? 'https://e621.net' : 'https://danbooru.donmai.us')
      
      begin
        # Determine which parser to use
        parser = nil
        if defined?(DText::Ruby) && DText::Ruby.respond_to?(:parse)
          parser = DText::Ruby
        elsif defined?(DTextR) && DTextR.respond_to?(:parse)
          parser = DTextR
        elsif defined?(DText) && DText.respond_to?(:parse)
          parser = DText
        else
          raise "No parser available"
        end
        
        # Call parser with options - match Danbooru's exact usage pattern
        # https://github.com/danbooru/danbooru/blob/master/app/logical/d_text.rb#L278
        # DText.parse(dtext, inline:, disable_mentions:, media_embeds:, base_url:, domain:, internal_domains:, emoji_list:)
        # Additional: source parameter for custom CSS classes and wiki link handling
        html_output = DText.parse(
          dtext_content,
          inline: false,
          media_embeds: true,
          disable_mentions: false,
          base_url: base_url,
          domain: nil,
          internal_domains: [],
          emoji_list: [],
          source: source  # Pass source for custom CSS classes
        )
        
        # Validate output
        unless html_output.is_a?(String)
          raise "Parser returned non-string output: #{html_output.class}"
        end
        
        # Send success response
        response = {
          success: true,
          html: html_output,
          request_id: request['request_id'] # Echo request_id if provided
        }
        
        puts JSON.generate(response)
        $stdout.flush
      rescue => parse_error
        # Parser-specific error - log to stderr for debugging
        $stderr.puts "DText parse error: #{parse_error.message}"
        $stderr.puts "Parser class: #{parser.inspect}" if defined?(parser)
        $stderr.puts "Source: #{source}, Base URL: #{base_url}"
        $stderr.puts "DText content length: #{dtext_content.length}" if dtext_content
        $stderr.puts parse_error.backtrace.first(10).join("\n")
        
        response = {
          success: false,
          error: "Parse error: #{parse_error.message}",
          backtrace: parse_error.backtrace.first(10),
          request_id: request['request_id']
        }
        puts JSON.generate(response)
        $stdout.flush
      end
      
    rescue JSON::ParserError => e
      # Invalid JSON - request might not be parsed yet
      response = {
        success: false,
        error: "Invalid JSON: #{e.message}",
        request_id: nil
      }
      puts JSON.generate(response)
      $stdout.flush
    rescue => e
      # Other errors - request might not be defined if error occurred before parsing
      request_id = nil
      begin
        request_id = request.is_a?(Hash) ? request['request_id'] : nil
      rescue
        # request might not be in scope
      end
      
      response = {
        success: false,
        error: e.message,
        backtrace: e.backtrace.first(3),
        request_id: request_id
      }
      puts JSON.generate(response)
      $stdout.flush
    end
  end
rescue EOFError
  # stdin closed (EOF) - exit gracefully
  # This is normal when the parent process closes stdin
  exit 0
rescue => e
  # Unexpected error
  $stderr.puts "Fatal error: #{e.message}"
  exit 1
end

# Exit cleanly when stdin loop ends (stdin closed)
exit 0