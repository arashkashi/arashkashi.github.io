<?php

namespace App\Http\Middleware;

use Closure;
use Firebase\JWT\JWT;
use Firebase\JWT\ExpiredException;

use App\User;

class JWTMiddleware
{
    /**
     * Handle an incoming request.
     *
     * @param  \Illuminate\Http\Request  $request
     * @param  \Closure  $next
     * @return mixed
     */
    public function handle($request, Closure $next)
    {
        $token = $request->input('api_token');

        return response()->json(['error' => $token], 401);

        if (!token) {
            return response()->json([
                'error' => 'Token not provided'
            , 401]);
        }
        try 
        {
            $cred = JWT::decode($token, env('JWT_SECRET'), [HS256]);
        } catch (ExpiredException $e) 
        {
            return response()->json(['error' => 'provided token is expired'], 401);

        } catch (exception $e) 
        {
            return response()->json(['error' => 'error while decoding token'], 401);
        }

        $user = User::find($cred->sub);

        $request->auth = $user;

        return $next($request);
    }
}
