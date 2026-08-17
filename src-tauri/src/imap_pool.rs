use std::collections::HashMap;
use std::sync::Arc;

use tokio::net::TcpStream;
use tokio::sync::{Mutex as AsyncMutex, OwnedMutexGuard};

pub type ImapSession = async_imap::Session<async_native_tls::TlsStream<TcpStream>>;

/// Caches one logged-in IMAP session per account so repeated actions (open a
/// message, mark as read, sync) reuse the same TLS connection instead of
/// paying a fresh TCP+TLS+LOGIN round trip every time. Callers are expected
/// to evict a session on any operation failure so the next call reconnects.
#[derive(Default)]
pub struct ImapSessionPool {
    accounts: AsyncMutex<HashMap<i64, Arc<AsyncMutex<Option<ImapSession>>>>>,
}

impl ImapSessionPool {
    pub fn new() -> Self {
        Self::default()
    }

    /// Locks the account's session slot. The slot may be empty (`None`) on
    /// first use or after a previous operation evicted a dead session.
    pub async fn checkout(&self, account_id: i64) -> OwnedMutexGuard<Option<ImapSession>> {
        let slot = {
            let mut accounts = self.accounts.lock().await;
            accounts
                .entry(account_id)
                .or_insert_with(|| Arc::new(AsyncMutex::new(None)))
                .clone()
        };
        slot.lock_owned().await
    }

    /// Drops any cached session for the account, e.g. when the account is
    /// deleted or its stored connection settings change.
    pub async fn evict(&self, account_id: i64) {
        let slot = self.accounts.lock().await.remove(&account_id);
        let Some(slot) = slot else {
            return;
        };
        let mut guard = slot.lock().await;
        if let Some(mut session) = guard.take() {
            let _ = session.logout().await;
        }
    }
}
