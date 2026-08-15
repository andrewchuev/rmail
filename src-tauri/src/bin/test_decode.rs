use mailparse::parse_header;

fn decode_header(value: &[u8]) -> String {
    let mut header_bytes = Vec::with_capacity(value.len() + 9);
    header_bytes.extend_from_slice(b"Subject: ");
    header_bytes.extend_from_slice(value);
    
    if let Ok((parsed, _)) = parse_header(&header_bytes) {
        return parsed.get_value().trim().to_string();
    }
    
    String::from_utf8_lossy(value).trim().to_string()
}

fn main() {
    let subject = b"=?UTF-8?B?0J/RgNC40LLQtdGC?="; // "Привет" in utf-8 base64
    println!("Decoded: {:?}", decode_header(subject));
}
