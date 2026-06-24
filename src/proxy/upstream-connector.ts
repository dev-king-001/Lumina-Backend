import * as net from 'net';

export class UpstreamConnector {
    public connect(host: string, port: number, isKeepAlive: boolean): net.Socket {
        const socket = new net.Socket();
        
        socket.connect({ host, port }, () => {
            if (!isKeepAlive) {
                // Set SO_LINGER with timeout 0 on sockets where feasible 
                // to skip TIME_WAIT entirely for non-keepalive connections.
                // In Node.js, calling socket.destroy() achieves a similar RST behavior.
                socket.on('end', () => {
                    socket.destroy();
                });
            }
        });

        return socket;
    }
}
