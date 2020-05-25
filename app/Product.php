<?php

namespace App;

use Illuminate\Auth\Authenticatable;
use Illuminate\Contracts\Auth\Access\Authorizable as AuthorizableContract;
use Illuminate\Contracts\Auth\Authenticatable as AuthenticatableContract;
use Illuminate\Database\Eloquent\Model;
use Laravel\Lumen\Auth\Authorizable;
use App\Traits\UsesUuid;
use Firebase\JWT\JWT;
use Firebase\JWT\ExpiredException;

class Product extends Model implements AuthenticatableContract, AuthorizableContract
{
    use Authenticatable, Authorizable, UsesUuid;

    /**
     * The attributes that are mass assignable.
     *
     * @var array
     */
    protected $fillable = [
        'name', 'properties'
    ];

    /**
     * The attributes that arent mass asignable.
     *
     * @var array
     */
    protected $guarded = [
        'id'
    ];
}
