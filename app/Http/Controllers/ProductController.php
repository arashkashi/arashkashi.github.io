<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use App\Product;
use Illuminate\Support\Facades\Auth;
use Illuminate\Validation\ValidationException;

class ProductController extends Controller
{
    /**
     * Get all User.
     *
     * @return Response
     */
    public function allProducts()
    {
       return response()->json(['products' =>  Product::all()], 200);
   }

   public function addNewProductWith(Request $request) {

    try {
        $this->validate($request, [
            'name' => 'required|unique:products',
            'properties' => 'required'
        ]);

        $product = new Product;
        $product->name = $request->input('name');
        $product->properties = $request->input('properties');

        $product->save();

        return response()->json(['product' => $product, 'message' => 'Added'], 201);
    } catch (Exception $e) {

        return response()->json(['message' => 'Product creation Failed: General'], 409);
    } catch (\Illuminate\Validation\ValidationException $e) {
        // do whatever else you need todo for your use case

        return response()->json(['message' => 'Product creation Failed: validation'], 409);
    }
}
    public function deleteProduct($id) {

        try {
            $toBeDeleted = Product::findOrFail($id);
            $toBeDeleted->delete();

            return response()->json(['product' => $toBeDeleted, 'message' => 'Deleted'], 201);
        }
        catch (Exception $e) {

            return response()->json(['message' => 'Product creation Failed: General'], 409);
        }
    }

    public function singleProduct($id)
    {
        try {
            $product = Product::findOrFail($id);

            return response()->json(['product' => $product], 200);

        } catch (\Exception $e) {

            return response()->json(['message' => 'product not found!'], 404);
        }
    }

    public function updateProduct(Request $request) {

        try {
        $this->validate($request, [
            'product' => 'required'
        ]);

        $product_ = $request->input('product');
        $product_id = $product_['id'];
        $product = Product::findOrFail($product_id);
        $product->name = $product_['name'];
        $product->properties = $product_['properties'];

        $product->save();

        return response()->json(['product' => $product['id'], 'message' => 'updated'], 201);
    } catch (Exception $e) {

        return response()->json(['message' => 'Product creation Failed: General'], 409);
    }

    }
}