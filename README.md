# Lumen PHP Framework
salam
## License

The Lumen framework is open-sourced software licensed under the [MIT license](https://opensource.org/licenses/MIT).

# To Create a new (user) table
```php artisan make:migration create_users_table --create=users```

# MySql version 8 Auth problem
when creating a user use the following
```
CREATE USER 'ohdear_ci'@'localhost' IDENTIFIED WITH mysql_native_password BY 'ohdear_secret';
GRANT ALL PRIVILEGES ON ohdear_ci.* TO 'ohdear_ci'@'localhost';
```
For an already created user use
```
ALTER USER 'ohdear_ci'@'localhost' IDENTIFIED WITH mysql_native_password BY 'ohdear_secret';
```

# For JWT auth the following links
https://jwt-auth.readthedocs.io/en/develop/lumen-installation/
```php artisan jwt:secret``` -> this basically adds secret variable into the env file.

https://dev.to/ndiecodes/build-a-jwt-authenticated-api-with-lumen-2afm


# Lumen PHP Framework

[![Build Status](https://travis-ci.org/laravel/lumen-framework.svg)](https://travis-ci.org/laravel/lumen-framework)
[![Total Downloads](https://poser.pugx.org/laravel/lumen-framework/d/total.svg)](https://packagist.org/packages/laravel/lumen-framework)
[![Latest Stable Version](https://poser.pugx.org/laravel/lumen-framework/v/stable.svg)](https://packagist.org/packages/laravel/lumen-framework)
[![License](https://poser.pugx.org/laravel/lumen-framework/license.svg)](https://packagist.org/packages/laravel/lumen-framework)

Laravel Lumen is a stunningly fast PHP micro-framework for building web applications with expressive, elegant syntax. We believe development must be an enjoyable, creative experience to be truly fulfilling. Lumen attempts to take the pain out of development by easing common tasks used in the majority of web projects, such as routing, database abstraction, queueing, and caching.

## License

The Lumen framework is open-sourced software licensed under the [MIT license](https://opensource.org/licenses/MIT).



## To create the project skeleton

The following will create a new folder `auth` with Lumen framework.

` composer create-project --prefer-dist laravel/lumen auth` 

## Build Docker Image

```bash
$ docker build --file .docker/Dockerfile -t nesha-docker .
```

*-t* indiates the name of the image

. indiates to run the build process in the context of the current folder.

## See locally build docker images

```bash
docker images
```

In order to see all the images created locally run the above command.

## Run Image

`$ docker run --name laravel-app --rm -p 8080:80 laravel-docker `

`--name` assigned a name to the newly running container.

`--rm` will remove the app after we hit ctrl+C

`8080:80` map 8080 on local machine to 80 on container.

`larave-docker` is the name of docker image.

## Run Docker with Compose

It is often needed to run multiple docker files together andto set the all up together and run the compose tool is used. To start using the compose yaml file run the following in terminal.

```
$ docker-compose up --build
```

## Run bash inside the container

It possible to enter the docker container that runs the app and run bash commands

First one need the ID of the container or its name

```
docker ps -a
```



#####  Using docker-compose

you can go inside and execute something inside the container

$ docker-compose exec app /bin/bash

root@4c1ee740cb92:/srv/app#

##### Using Docker

`$ docker ps`

`CONTAINER ID    IMAGE`

`4c1ee740cb92    laravel-docker`

`ba094abe8c85    redis:4.0-alpine`

`6dce0efa2dc6    mysql:5.7`

`$ docker exec -it 4c1ee740cb92 /bin/bash`

`root@4c1ee740cb92:/srv/app#`

## Migrating database

In order to migrate the database, i.e. creating the table etc. we need to run artisan command inside the container. After entering the container like explained above, run the following in the container's bash

`$ php artisan migrate`


## Finding where the php.ini is
'''php -i | grep php.ini'''

## Enableing new config for Apache 2
'''
a2dissite 000-default.conf
a2ensite 001-lumen-api.conf
'''





