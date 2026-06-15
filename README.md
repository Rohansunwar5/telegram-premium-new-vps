sudo docker run -d -p 6379:6379 --add-host=host.docker.internal:host-gateway --restart=unless-stopped --name redis redis

use host.docker.internal as in place of localhost - redis.