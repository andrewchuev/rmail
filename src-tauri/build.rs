use std::{env, fs, path::PathBuf};

fn load_env_value(key: &str) -> Option<String> {
    if let Ok(value) = env::var(key) {
        return Some(value);
    }

    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").ok()?);
    let contents = fs::read_to_string(manifest_dir.parent()?.join(".env")).ok()?;
    contents.lines().find_map(|line| {
        let (name, value) = line.split_once('=')?;
        (name.trim() == key).then(|| value.trim().trim_matches(['\'', '"']).to_string())
    })
}

fn main() {
    println!("cargo:rerun-if-changed=../.env");
    for key in ["RMAIL_GOOGLE_CLIENT_ID", "RMAIL_GOOGLE_CLIENT_SECRET"] {
        println!("cargo:rerun-if-env-changed={key}");
        if let Some(value) = load_env_value(key) {
            println!("cargo:rustc-env={key}={value}");
        }
    }
    tauri_build::build()
}
