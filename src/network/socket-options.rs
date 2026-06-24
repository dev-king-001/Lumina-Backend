use std::os::unix::io::AsRawFd;
use std::net::TcpStream;

pub fn configure_socket_options(stream: &TcpStream) -> std::io::Result<()> {
    let fd = stream.as_raw_fd();
    unsafe {
        let optval: libc::c_int = 1;
        // Enable SO_REUSEADDR on all outbound sockets to allow port reuse before TIME_WAIT expires
        libc::setsockopt(
            fd,
            libc::SOL_SOCKET,
            libc::SO_REUSEADDR,
            &optval as *const _ as *const libc::c_void,
            std::mem::size_of_val(&optval) as libc::socklen_t,
        );
        // Enable SO_REUSEPORT
        #[cfg(target_os = "linux")]
        libc::setsockopt(
            fd,
            libc::SOL_SOCKET,
            libc::SO_REUSEPORT,
            &optval as *const _ as *const libc::c_void,
            std::mem::size_of_val(&optval) as libc::socklen_t,
        );
    }
    Ok(())
}
