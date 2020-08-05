# nCube-steer
Start Guide

- Install dependencies 

In the sparrow board
 
```
$ curl -sL https://deb.nodesource.com/setup_10.x | sudo -E bash -

$ sudo apt-get install -y nodejs

$ node -v

$ sudo npm install -g pm2

$ git clone https://github.com/IoTKETI/nCube-sparrow

$ cd /home/pi/nCube-sparrow  

$ npm install
```

- Autorun at boot

```
$ sudo nano /etc/xdg/lxsession/LXDE-pi/autostart

Add executable code to last line

$ sh /home/pi/nCube-sparrow/auto.sh > /home/pi/nCube-sparrow/auto.sh.log 2>&1
```
