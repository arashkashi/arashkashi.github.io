<?php

/*
|--------------------------------------------------------------------------
| Application Routes
|--------------------------------------------------------------------------
|
| Here is where you can register all of the routes for an application.
| It is a breeze. Simply tell Lumen the URIs it should respond to
| and give it the Closure to call when that URI is requested.
|
*/

$router->get('/', function () use ($router) {
    return $router->app->version();
});

$router->post('register', 'AuthController@register');

$router->post('login', 'AuthController@login');

$router->post('/php_ini/{id}', 'Controller@php_ini');

// API route group
$router->group(['prefix' => 'api', 'middleware' => 'auth'], function () use ($router) {

    $router->post('profile', 'UserController@profile');

    $router->post('users/{id}', 'UserController@singleUser');

    $router->post('users', 'UserController@allUsers');

    $router->post('products/addNewProduct', 'ProductController@addNewProductWith');

    $router->post('products/delete/{id}', 'ProductController@deleteProduct');

    $router->post('products/update', 'ProductController@updateProduct');

    $router->post('products/{id}', 'ProductController@singleProduct');

    $router->post('products', 'ProductController@allProducts');

	$router->post('files/save', 'FilesController@saveFile');
	// $router->post('list', 'FilesController@getFileList');
	$router->get('files/view-media/{filename}', 'FilesController@viewMediaFile');
	$router->get('files/delete/{filename}', 'FilesController@deleteFile');
});
