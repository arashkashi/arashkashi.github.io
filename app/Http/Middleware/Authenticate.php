<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Contracts\Auth\Factory as Auth;
use Firebase\JWT\JWT;
use Firebase\JWT\ExpiredException;
use Illuminate\Http\Request;

use App\User;

class Authenticate
{
    /**
     * The authentication guard factory instance.
     *
     * @var \Illuminate\Contracts\Auth\Factory
     */
    protected $auth;

    /**
     * Create a new middleware instance.
     *
     * @param  \Illuminate\Contracts\Auth\Factory  $auth
     * @return void
     */
    public function __construct(Auth $auth)
    {
        $this->auth = $auth;
    }

    /**
     * Handle an incoming request.
     *
     * @param  \Illuminate\Http\Request  $request
     * @param  \Closure  $next
     * @param  string|null  $guard
     * @return mixed
     */
    public function handle($request, Closure $next, $guard = null)
    {
        try {
            $token = $request->header('bearer', "invalid-default-token");

            $cred = JWT::decode($token, env('JWT_SECRET'), ['HS256']);
            $request->user_id = $cred->sub;

            return $next($request);
        } catch (ExpiredException $e) {

            return response()->json(['error' => 'provided token is expired'], 401);
        } 
        catch ( \Exception $e) {

            return response()->json(['error' => 'error while decoding token'], 401);
        }
    }
}
